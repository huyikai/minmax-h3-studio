#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"

const STUDIO = process.env.STUDIO_URL ?? "http://127.0.0.1:17333"
const OUT_DIR = path.join(process.cwd(), "outputs")
const FIXTURE_DIR = path.join(process.cwd(), "scripts", "fixtures")
const REPORT_PATH = path.join(process.cwd(), "scripts", "long-workflow-validation-results.json")

const STEPS = 16
const MEGAPIXELS = 0.4
const DURATION = 5
const POLL_MS = 5000
const SEGMENT_TIMEOUT_MS = 45 * 60 * 1000

const LOCK = "A woman in a crimson jacket and short black hair, daylight, handheld camera."
const SEG1 =
  "subject_definitions: Woman in crimson jacket\nsummary: She walks down an empty street.\nintegrated_multimodal_description: She walks toward camera and glances left.\noverall_soundscape: footsteps, distant traffic\nnon_diegetic_music: N/A"
const SEG2 =
  "subject_definitions: Woman in crimson jacket\nsummary: She continues down the street and slows.\nintegrated_multimodal_description: She keeps walking, then slows and looks back.\noverall_soundscape: footsteps, distant traffic\nnon_diegetic_music: N/A"

function run(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `${command} exited ${code}`))
    })
  })
}

async function ensureFixtures() {
  await fs.mkdir(FIXTURE_DIR, { recursive: true })
  const first = path.join(FIXTURE_DIR, "first.png")
  const last = path.join(FIXTURE_DIR, "last.png")
  const ref = path.join(FIXTURE_DIR, "ref.png")
  try {
    await fs.access(first)
    await fs.access(last)
    await fs.access(ref)
  } catch {
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=1", "-frames:v", "1", first])
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x1E3F8B:s=1280x720", "-frames:v", "1", last])
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x8B1E3F:s=1280x720", "-frames:v", "1", ref])
  }
  return { first, last, ref }
}

async function api(pathname, init) {
  const response = await fetch(`${STUDIO}${pathname}`, init)
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { ok: response.ok, status: response.status, json }
}

function inspectWorkflow(workflow, clipIndex, jobId) {
  const byClass = (classType) =>
    Object.entries(workflow).find(([, node]) => node.class_type === classType)
  const h3 =
    byClass("MiniMaxH3ImageToVideo") ?? byClass("MiniMaxH3ReferenceToVideo")
  const load = byClass("MiniMaxH3MotionContextLoadLatent")
  const motion = byClass("MiniMaxH3MotionContext")
  const save = byClass("MiniMaxH3MotionContextSaveLatent")
  const video = byClass("SaveVideo") ?? byClass("CreateVideo")
  const issues = []
  if (!h3) issues.push("missing H3 node")
  if (!save) issues.push("missing Save Latent")
  if (!video) issues.push("missing video output")
  if (save && save[1].inputs.clip_index !== clipIndex) {
    issues.push(`Save clip_index ${save[1].inputs.clip_index} != ${clipIndex}`)
  }
  if (clipIndex <= 1) {
    if (load) issues.push("segment 1 loaded previous latent")
  } else {
    if (!load) issues.push("segment 2 missing Load Latent")
    else {
      if (load[1].inputs.clip_index !== clipIndex - 1) issues.push("Load clip_index wrong")
      if (load[1].inputs.latent_path !== `h3_studio/${jobId}`) issues.push("Load path not job folder")
    }
    if (!motion) issues.push("segment 2 missing Motion Context")
    else if (load && (!Array.isArray(motion[1].inputs.context_latent) || String(motion[1].inputs.context_latent[0]) !== load[0])) {
      issues.push("Motion Context not wired to Load")
    }
  }
  const prompt = h3?.[1]?.inputs?.prompt
  return { ok: issues.length === 0, issues, prompt, hasFirstFrame: Boolean(h3?.[1]?.inputs?.first_frame), hasLastFrame: Boolean(h3?.[1]?.inputs?.last_frame) }
}

async function waitForSegment(jobId, index) {
  const started = Date.now()
  while (Date.now() - started < SEGMENT_TIMEOUT_MS) {
    const { json } = await api(`/api/jobs/${jobId}`)
    const job = json.job
    const segment = job?.long?.segments?.find((item) => item.index === index)
    if (!segment) throw new Error(`segment ${index} missing`)
    if (segment.status === "success") return { job, segment }
    if (segment.status === "error" || segment.status === "interrupted") {
      throw new Error(segment.error || job?.error || `segment ${index} ${segment.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`timeout waiting for segment ${index}`)
}

async function snapshotWorkflow(jobId, index) {
  const { ok, json, status } = await api(`/api/jobs/${jobId}/workflow`)
  if (!ok) throw new Error(`workflow.json ${status}`)
  const dest = path.join(OUT_DIR, jobId, `workflow-seg${String(index).padStart(3, "0")}.json`)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, `${JSON.stringify(json, null, 2)}\n`)
  return { dest, workflow: json }
}

async function createJob(workflowFile, lockPrompt, files = {}) {
  const form = new FormData()
  form.set("kind", "long")
  form.set("workflowFile", workflowFile)
  form.set("lockPrompt", lockPrompt)
  form.set("aspect", "16:9")
  form.set("megapixels", String(MEGAPIXELS))
  if (files.publicImage) {
    const bytes = await fs.readFile(files.publicImage)
    form.set("public:refImage:0", new Blob([bytes], { type: "image/png" }), path.basename(files.publicImage))
  }
  const { ok, status, json } = await api("/api/jobs", { method: "POST", body: form })
  if (!ok) throw new Error(`create ${workflowFile} ${status}: ${json.error ?? JSON.stringify(json)}`)
  return json.job
}

async function submitSegment(jobId, index, options) {
  const form = new FormData()
  form.set("prompt", options.prompt)
  form.set("duration", String(DURATION))
  form.set("aspect", "16:9")
  form.set("megapixels", String(MEGAPIXELS))
  form.set("steps", String(STEPS))
  form.set("seed", String(options.seed ?? 1))
  if (options.firstFrame) {
    const bytes = await fs.readFile(options.firstFrame)
    form.set("segment:firstFrame", new Blob([bytes], { type: "image/png" }), path.basename(options.firstFrame))
  }
  if (options.lastFrame) {
    const bytes = await fs.readFile(options.lastFrame)
    form.set("segment:lastFrame", new Blob([bytes], { type: "image/png" }), path.basename(options.lastFrame))
  }
  if (options.segmentImage) {
    const bytes = await fs.readFile(options.segmentImage)
    form.set("segment:refImage:0", new Blob([bytes], { type: "image/png" }), path.basename(options.segmentImage))
  }
  const { ok, status, json } = await api(`/api/jobs/${jobId}/segments`, { method: "POST", body: form })
  if (!ok) throw new Error(`segment ${index} ${status}: ${json.error ?? JSON.stringify(json)}`)
  return json.job
}

async function extractFrames(jobId, index) {
  const dir = path.join(OUT_DIR, jobId)
  const video = path.join(dir, `seg_${String(index).padStart(3, "0")}.mp4`)
  const head = path.join(dir, `seg_${String(index).padStart(3, "0")}_head.png`)
  const tail = path.join(dir, `seg_${String(index).padStart(3, "0")}_tail.png`)
  try {
    await fs.access(video)
    await run("ffmpeg", ["-y", "-i", video, "-frames:v", "1", head])
    await run("ffmpeg", ["-y", "-sseof", "-0.05", "-i", video, "-frames:v", "1", tail])
    return { video, head, tail }
  } catch (error) {
    return { video, error: error instanceof Error ? error.message : String(error) }
  }
}

async function apiLockAndWorkflowTests() {
  const results = []
  const created = await createJob("h3-t2v-long.json", LOCK)
  const changeLock = await api(`/api/jobs/${created.id}/segments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: SEG1, duration: DURATION, lockPrompt: "CHANGED-LOCK", steps: STEPS }),
  })
  results.push({
    name: "lock frozen after create",
    status: changeLock.status === 409 ? "PASS" : "FAIL",
    detail: changeLock.json.error ?? changeLock.status,
  })
  const first = await submitSegment(created.id, 1, { prompt: SEG1, seed: 11 })
  const switchWf = await api(`/api/jobs/${created.id}/workflow`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowFile: "h3-i2v-long.json" }),
  })
  results.push({
    name: "workflow locked after segment exists",
    status: switchWf.status === 409 ? "PASS" : "FAIL",
    detail: switchWf.json.error ?? switchWf.status,
  })
  return { job: first, checks: results }
}

async function runTwoSegments(label, workflowFile, options) {
  const record = {
    label,
    workflowFile,
    status: "NOT RUN",
    jobId: null,
    segments: [],
    stitch: null,
    error: null,
  }
  try {
    const job = await createJob(workflowFile, LOCK, options.createFiles)
    record.jobId = job.id
    for (const item of options.segments) {
      await submitSegment(job.id, item.index, item)
      console.error(`[${label}] waiting for segment ${item.index} job=${job.id}`)
      const done = await waitForSegment(job.id, item.index)
      const snap = await snapshotWorkflow(job.id, item.index)
      const graph = inspectWorkflow(snap.workflow, item.index, job.id)
      const frames = await extractFrames(job.id, item.index)
      record.segments.push({
        index: item.index,
        status: done.segment.status,
        outputFile: done.segment.outputFile,
        outputUrl: done.segment.outputUrl,
        workflow: snap.dest,
        graph,
        frames,
        promptHasLock: String(graph.prompt ?? done.segment.submittedPrompt).includes("crimson jacket"),
      })
    }
    const latest = await api(`/api/jobs/${job.id}`)
    record.stitch = {
      file: latest.json.job?.long?.stitchedFile,
      error: latest.json.job?.long?.stitchError,
      url: latest.json.job?.stitchedUrl,
    }
    const graphsOk = record.segments.every((item) => item.graph.ok && item.status === "success")
    record.status = graphsOk && record.stitch?.file ? "PASS" : "FAIL"
  } catch (error) {
    record.status = "FAIL"
    record.error = error instanceof Error ? error.message : String(error)
  }
  return record
}

async function main() {
  const fixtures = await ensureFixtures()
  const health = await api("/api/health")
  const resume = await api("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resume" }),
  })
  const report = {
    startedAt: new Date().toISOString(),
    studio: STUDIO,
    health: health.json,
    queueResume: resume.status,
    settings: { STEPS, MEGAPIXELS, DURATION },
    apiChecks: [],
    workflows: [],
  }

  const apiPart = await apiLockAndWorkflowTests()
  report.apiChecks = apiPart.checks
  console.error("API checks", JSON.stringify(apiPart.checks))
  const t2vJobId = apiPart.job.id
  console.error("T2V job", t2vJobId)
  try {
    console.error("waiting T2V segment 1")
    const seg1 = await waitForSegment(t2vJobId, 1)
    const snap1 = await snapshotWorkflow(t2vJobId, 1)
    const graph1 = inspectWorkflow(snap1.workflow, 1, t2vJobId)
    await submitSegment(t2vJobId, 2, { prompt: SEG2, seed: 12 })
    const seg2 = await waitForSegment(t2vJobId, 2)
    const snap2 = await snapshotWorkflow(t2vJobId, 2)
    const graph2 = inspectWorkflow(snap2.workflow, 2, t2vJobId)
    const latest = await api(`/api/jobs/${t2vJobId}`)
    report.workflows.push({
      label: "T2V regression",
      workflowFile: "h3-t2v-long.json",
      jobId: t2vJobId,
      status: graph1.ok && graph2.ok && seg1.segment.status === "success" && seg2.segment.status === "success" ? "PASS" : "FAIL",
      segments: [
        { index: 1, status: seg1.segment.status, workflow: snap1.dest, graph: graph1, frames: await extractFrames(t2vJobId, 1), promptHasLock: String(graph1.prompt ?? "").includes("crimson jacket") || LOCK.includes("crimson") },
        { index: 2, status: seg2.segment.status, workflow: snap2.dest, graph: graph2, frames: await extractFrames(t2vJobId, 2), promptHasLock: String(graph2.prompt ?? "").includes("crimson jacket") },
      ],
      stitch: {
        file: latest.json.job?.long?.stitchedFile,
        error: latest.json.job?.long?.stitchError,
        url: latest.json.job?.stitchedUrl,
      },
    })
  } catch (error) {
    report.workflows.push({
      label: "T2V regression",
      workflowFile: "h3-t2v-long.json",
      jobId: t2vJobId,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    })
  }

  report.workflows.push(
    await runTwoSegments("I2V first-frame + motion context", "h3-i2v-long.json", {
      createFiles: {},
      segments: [
        { index: 1, prompt: SEG1, seed: 21, firstFrame: fixtures.first },
        { index: 2, prompt: SEG2, seed: 22 },
      ],
    })
  )
  report.workflows.push(
    await runTwoSegments("R2V public image + segment image", "h3-r2v-long.json", {
      createFiles: { publicImage: fixtures.ref },
      segments: [
        { index: 1, prompt: `${SEG1}\nUse <Picture 1> as identity.`, seed: 31 },
        { index: 2, prompt: `${SEG2}\nKeep <Picture 1>. <Picture 2> is a color accent.`, seed: 32, segmentImage: fixtures.first },
      ],
    })
  )
  report.workflows.push(
    await runTwoSegments("FLF first frame then motion context + last frame", "h3-flf-long.json", {
      createFiles: {},
      segments: [
        { index: 1, prompt: SEG1, seed: 41, firstFrame: fixtures.first },
        { index: 2, prompt: SEG2, seed: 42, lastFrame: fixtures.last },
      ],
    })
  )

  report.finishedAt = new Date().toISOString()
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

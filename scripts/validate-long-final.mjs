#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"

const STUDIO = process.env.STUDIO_URL ?? "http://127.0.0.1:17333"
const OUT_DIR = path.join(process.cwd(), "outputs")
const FIXTURE_DIR = path.join(process.cwd(), "scripts", "fixtures")
const REPORT_PATH = path.join(process.cwd(), "scripts", "long-workflow-final-results.json")

const DURATION = 5
const POLL_MS = 5000
const SEGMENT_TIMEOUT_MS = 60 * 60 * 1000

const LOCK = "A woman in a crimson jacket and short black hair, daylight, handheld camera."
const SEG1 =
  "subject_definitions: Woman in crimson jacket\nsummary: She walks down an empty street.\nintegrated_multimodal_description: She walks toward camera and glances left.\noverall_soundscape: footsteps, distant traffic\nnon_diegetic_music: N/A"
const SEG2 =
  "subject_definitions: Woman in crimson jacket\nsummary: She continues down the street and slows.\nintegrated_multimodal_description: She keeps walking, then slows and looks back.\noverall_soundscape: footsteps, distant traffic\nnon_diegetic_music: N/A"
const CUT2 =
  "subject_definitions: Woman in crimson jacket\nsummary: Hard cut to a close-up of her face at a cafe window.\nintegrated_multimodal_description: Sudden new shot: close-up, she looks out a cafe window at dusk.\noverall_soundscape: cafe murmur\nnon_diegetic_music: N/A"

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
  const audio = path.join(FIXTURE_DIR, "ref.wav")
  const video = path.join(FIXTURE_DIR, "ref.mp4")
  const make = async (file, args) => {
    try {
      await fs.access(file)
    } catch {
      await run("ffmpeg", ["-y", ...args, file])
    }
  }
  await make(audio, ["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ar", "32000", "-ac", "1"])
  await make(video, [
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=24",
    "-t",
    "2",
    "-pix_fmt",
    "yuv420p",
  ])
  return { audio, video }
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

function refKeys(workflow, prefix) {
  const h3 = Object.values(workflow).find(
    (node) =>
      node.class_type === "MiniMaxH3ImageToVideo" ||
      node.class_type === "MiniMaxH3ReferenceToVideo"
  )
  return Object.keys(h3?.inputs ?? {}).filter((key) => key.startsWith(prefix))
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
    else if (
      load &&
      (!Array.isArray(motion[1].inputs.context_latent) ||
        String(motion[1].inputs.context_latent[0]) !== load[0])
    ) {
      issues.push("Motion Context not wired to Load")
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    prompt: h3?.[1]?.inputs?.prompt,
    h3Class: h3?.[1]?.class_type,
    width: h3?.[1]?.inputs?.width,
    height: h3?.[1]?.inputs?.height,
    refImages: refKeys(workflow, "ref_images."),
    refVideos: refKeys(workflow, "ref_videos."),
    refAudios: refKeys(workflow, "ref_audios."),
    hasLoadAudio: Boolean(byClass("LoadAudio")),
    hasLoadVideo: Boolean(byClass("LoadVideo")),
  }
}

function applyExpect(graph, expect) {
  if (!expect) return graph
  const issues = [...graph.issues]
  if (expect.images != null && graph.refImages.length !== expect.images) {
    issues.push(`ref images ${graph.refImages.length} != ${expect.images}`)
  }
  if (expect.videos != null && graph.refVideos.length !== expect.videos) {
    issues.push(`ref videos ${graph.refVideos.length} != ${expect.videos}`)
  }
  if (expect.audios != null && graph.refAudios.length !== expect.audios) {
    issues.push(`ref audios ${graph.refAudios.length} != ${expect.audios}`)
  }
  if (expect.h3Class && graph.h3Class !== expect.h3Class) {
    issues.push(`H3 class ${graph.h3Class} != ${expect.h3Class}`)
  }
  return { ...graph, ok: issues.length === 0, issues }
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

async function attachFile(form, key, filePath, type) {
  const bytes = await fs.readFile(filePath)
  form.set(key, new Blob([bytes], { type }), path.basename(filePath))
}

async function createJob(workflowFile, lockPrompt, files = {}, settings = {}) {
  const form = new FormData()
  form.set("kind", "long")
  form.set("workflowFile", workflowFile)
  form.set("lockPrompt", lockPrompt)
  form.set("aspect", "16:9")
  form.set("megapixels", String(settings.megapixels ?? 0.4))
  if (files.publicImage) await attachFile(form, "public:refImage:0", files.publicImage, "image/png")
  if (files.publicVideo) await attachFile(form, "public:refVideo:0", files.publicVideo, "video/mp4")
  if (files.publicAudio) await attachFile(form, "public:refAudio:0", files.publicAudio, "audio/wav")
  const { ok, status, json } = await api("/api/jobs", { method: "POST", body: form })
  if (!ok) throw new Error(`create ${workflowFile} ${status}: ${json.error ?? JSON.stringify(json)}`)
  return json.job
}

async function submitSegment(jobId, options) {
  const form = new FormData()
  form.set("prompt", options.prompt)
  form.set("duration", String(DURATION))
  form.set("aspect", "16:9")
  form.set("megapixels", String(options.megapixels ?? 0.4))
  form.set("steps", String(options.steps ?? 16))
  form.set("seed", String(options.seed ?? 1))
  if (options.segmentAudio) {
    await attachFile(form, "segment:refAudio:0", options.segmentAudio, "audio/wav")
  }
  if (options.segmentVideo) {
    await attachFile(form, "segment:refVideo:0", options.segmentVideo, "video/mp4")
  }
  const { ok, status, json } = await api(`/api/jobs/${jobId}/segments`, { method: "POST", body: form })
  if (!ok) throw new Error(`segment ${options.index} ${status}: ${json.error ?? JSON.stringify(json)}`)
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

async function runTwoSegments(label, workflowFile, options) {
  const record = {
    label,
    workflowFile,
    status: "NOT RUN",
    jobId: null,
    settings: { steps: options.steps, megapixels: options.megapixels },
    segments: [],
    stitch: null,
    error: null,
  }
  try {
    const job = await createJob(workflowFile, LOCK, options.createFiles, {
      megapixels: options.megapixels,
    })
    record.jobId = job.id
    record.width = job.width
    record.height = job.height
    for (const item of options.segments) {
      await submitSegment(job.id, {
        ...item,
        steps: options.steps,
        megapixels: options.megapixels,
      })
      console.error(`[${label}] waiting for segment ${item.index} job=${job.id}`)
      const done = await waitForSegment(job.id, item.index)
      const snap = await snapshotWorkflow(job.id, item.index)
      const graph = applyExpect(inspectWorkflow(snap.workflow, item.index, job.id), item.expect)
      record.segments.push({
        index: item.index,
        status: done.segment.status,
        outputFile: done.segment.outputFile,
        workflow: snap.dest,
        graph,
        frames: await extractFrames(job.id, item.index),
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
    workflows: [],
  }

  report.workflows.push(
    await runTwoSegments("R2V public audio only", "h3-r2v-long.json", {
      megapixels: 0.4,
      steps: 16,
      createFiles: { publicAudio: fixtures.audio },
      segments: [
        {
          index: 1,
          prompt: `${SEG1}\nFollow the reference audio rhythm. No still photo.`,
          seed: 91,
          expect: { h3Class: "MiniMaxH3ReferenceToVideo", images: 0, audios: 1, videos: 0 },
        },
        {
          index: 2,
          prompt: `${SEG2}\nKeep the same audio bed.`,
          seed: 92,
          expect: { h3Class: "MiniMaxH3ReferenceToVideo", images: 0, audios: 1, videos: 0 },
        },
      ],
    })
  )
  report.workflows.push(
    await runTwoSegments("R2V public video only", "h3-r2v-long.json", {
      megapixels: 0.4,
      steps: 16,
      createFiles: { publicVideo: fixtures.video },
      segments: [
        {
          index: 1,
          prompt: `${SEG1}\nMatch motion from <Video 1>. No still photo.`,
          seed: 101,
          expect: { h3Class: "MiniMaxH3ReferenceToVideo", images: 0, videos: 1, audios: 0 },
        },
        {
          index: 2,
          prompt: `${SEG2}\nContinue <Video 1>.`,
          seed: 102,
          expect: { h3Class: "MiniMaxH3ReferenceToVideo", images: 0, videos: 1, audios: 0 },
        },
      ],
    })
  )
  report.workflows.push(
    await runTwoSegments("T2V production 0.98MP 20 steps with a prompted cut", "h3-t2v-long.json", {
      megapixels: 0.98,
      steps: 20,
      createFiles: {},
      segments: [
        { index: 1, prompt: SEG1, seed: 111, expect: { h3Class: "MiniMaxH3ImageToVideo" } },
        { index: 2, prompt: CUT2, seed: 112, expect: { h3Class: "MiniMaxH3ImageToVideo" } },
      ],
    })
  )

  report.finishedAt = new Date().toISOString()
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (report.workflows.some((item) => item.status !== "PASS")) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

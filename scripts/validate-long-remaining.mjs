#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"

const STUDIO = process.env.STUDIO_URL ?? "http://127.0.0.1:17333"
const OUT_DIR = path.join(process.cwd(), "outputs")
const FIXTURE_DIR = path.join(process.cwd(), "scripts", "fixtures")
const REPORT_PATH = path.join(process.cwd(), "scripts", "long-workflow-remaining-results.json")

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
  const audio = path.join(FIXTURE_DIR, "ref.wav")
  const video = path.join(FIXTURE_DIR, "ref.mp4")
  const make = async (file, args) => {
    try {
      await fs.access(file)
    } catch {
      await run("ffmpeg", ["-y", ...args, file])
    }
  }
  await make(first, ["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=1", "-frames:v", "1"])
  await make(last, ["-f", "lavfi", "-i", "color=c=0x1E3F8B:s=1280x720", "-frames:v", "1"])
  await make(ref, ["-f", "lavfi", "-i", "color=c=0x8B1E3F:s=1280x720", "-frames:v", "1"])
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
  return { first, last, ref, audio, video }
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
  const prompt = h3?.[1]?.inputs?.prompt
  return {
    ok: issues.length === 0,
    issues,
    prompt,
    h3Class: h3?.[1]?.class_type,
    hasFirstFrame: Boolean(h3?.[1]?.inputs?.first_frame),
    hasLastFrame: Boolean(h3?.[1]?.inputs?.last_frame),
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
  if (expect.firstFrame != null && graph.hasFirstFrame !== expect.firstFrame) {
    issues.push(`first_frame ${graph.hasFirstFrame} != ${expect.firstFrame}`)
  }
  if (expect.lastFrame != null && graph.hasLastFrame !== expect.lastFrame) {
    issues.push(`last_frame ${graph.hasLastFrame} != ${expect.lastFrame}`)
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

async function snapshotWorkflow(jobId, index, suffix = "") {
  const { ok, json, status } = await api(`/api/jobs/${jobId}/workflow`)
  if (!ok) throw new Error(`workflow.json ${status}`)
  const dest = path.join(
    OUT_DIR,
    jobId,
    `workflow-seg${String(index).padStart(3, "0")}${suffix}.json`
  )
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, `${JSON.stringify(json, null, 2)}\n`)
  return { dest, workflow: json }
}

async function attachFile(form, key, filePath, type) {
  const bytes = await fs.readFile(filePath)
  form.set(key, new Blob([bytes], { type }), path.basename(filePath))
}

async function createJob(workflowFile, lockPrompt, files = {}) {
  const form = new FormData()
  form.set("kind", "long")
  form.set("workflowFile", workflowFile)
  form.set("lockPrompt", lockPrompt)
  form.set("aspect", "16:9")
  form.set("megapixels", String(MEGAPIXELS))
  if (files.publicImage) await attachFile(form, "public:refImage:0", files.publicImage, "image/png")
  if (files.publicVideo) await attachFile(form, "public:refVideo:0", files.publicVideo, "video/mp4")
  if (files.publicAudio) await attachFile(form, "public:refAudio:0", files.publicAudio, "audio/wav")
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
  if (options.redoIndex != null) form.set("redoIndex", String(options.redoIndex))
  if (options.firstFrame) await attachFile(form, "segment:firstFrame", options.firstFrame, "image/png")
  if (options.lastFrame) await attachFile(form, "segment:lastFrame", options.lastFrame, "image/png")
  if (options.segmentImage) {
    await attachFile(form, "segment:refImage:0", options.segmentImage, "image/png")
  }
  if (options.segmentVideo) {
    await attachFile(form, "segment:refVideo:0", options.segmentVideo, "video/mp4")
  }
  if (options.segmentAudio) {
    await attachFile(form, "segment:refAudio:0", options.segmentAudio, "audio/wav")
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
      const graph = applyExpect(inspectWorkflow(snap.workflow, item.index, job.id), item.expect)
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

async function runRewrite() {
  const record = {
    label: "T2V rewrite segment 1 then rebuild Motion Context",
    workflowFile: "h3-t2v-long.json",
    status: "NOT RUN",
    jobId: null,
    segments: [],
    voidedAfterRedo: null,
    stitch: null,
    error: null,
  }
  try {
    const job = await createJob("h3-t2v-long.json", LOCK)
    record.jobId = job.id
    await submitSegment(job.id, 1, { prompt: SEG1, seed: 51 })
    console.error(`[rewrite] waiting original segment 1 job=${job.id}`)
    await waitForSegment(job.id, 1)
    await snapshotWorkflow(job.id, 1, "-original")
    await submitSegment(job.id, 2, { prompt: SEG2, seed: 52 })
    console.error(`[rewrite] waiting original segment 2 job=${job.id}`)
    await waitForSegment(job.id, 2)
    await snapshotWorkflow(job.id, 2, "-original")
    const redo = await submitSegment(job.id, 1, {
      prompt: `${SEG1}\nShe turns toward a shop window.`,
      seed: 53,
      redoIndex: 1,
    })
    record.voidedAfterRedo = redo.long?.segments?.map((item) => ({
      index: item.index,
      status: item.status,
    }))
    const laterVoided = redo.long?.segments?.some(
      (item) => item.index === 2 && item.status === "voided"
    )
    if (!laterVoided) throw new Error("rewriting segment 1 did not void segment 2")
    console.error(`[rewrite] waiting rewritten segment 1 job=${job.id}`)
    const seg1 = await waitForSegment(job.id, 1)
    const snap1 = await snapshotWorkflow(job.id, 1, "-rewrite")
    const graph1 = inspectWorkflow(snap1.workflow, 1, job.id)
    record.segments.push({
      index: 1,
      status: seg1.segment.status,
      workflow: snap1.dest,
      graph: graph1,
      frames: await extractFrames(job.id, 1),
      promptHasLock: String(graph1.prompt ?? "").includes("crimson jacket"),
    })
    await submitSegment(job.id, 2, { prompt: SEG2, seed: 54 })
    console.error(`[rewrite] waiting rebuilt segment 2 job=${job.id}`)
    const seg2 = await waitForSegment(job.id, 2)
    const snap2 = await snapshotWorkflow(job.id, 2, "-rebuild")
    const graph2 = inspectWorkflow(snap2.workflow, 2, job.id)
    record.segments.push({
      index: 2,
      status: seg2.segment.status,
      workflow: snap2.dest,
      graph: graph2,
      frames: await extractFrames(job.id, 2),
      promptHasLock: String(graph2.prompt ?? "").includes("crimson jacket"),
    })
    const latest = await api(`/api/jobs/${job.id}`)
    record.stitch = {
      file: latest.json.job?.long?.stitchedFile,
      error: latest.json.job?.long?.stitchError,
      url: latest.json.job?.stitchedUrl,
    }
    const graphsOk = record.segments.every((item) => item.graph.ok && item.status === "success")
    record.status = graphsOk && laterVoided && record.stitch?.file ? "PASS" : "FAIL"
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
    workflows: [],
  }

  report.workflows.push(
    await runTwoSegments("R2V public image + public audio", "h3-r2v-long.json", {
      createFiles: { publicImage: fixtures.ref, publicAudio: fixtures.audio },
      segments: [
        {
          index: 1,
          prompt: `${SEG1}\nUse <Picture 1> as identity. Follow the reference audio rhythm.`,
          seed: 61,
          expect: {
            h3Class: "MiniMaxH3ReferenceToVideo",
            images: 1,
            audios: 1,
            videos: 0,
            firstFrame: false,
          },
        },
        {
          index: 2,
          prompt: `${SEG2}\nKeep <Picture 1> and the same audio bed.`,
          seed: 62,
          expect: {
            h3Class: "MiniMaxH3ReferenceToVideo",
            images: 1,
            audios: 1,
            videos: 0,
          },
        },
      ],
    })
  )
  report.workflows.push(
    await runTwoSegments("R2V public image + public video", "h3-r2v-long.json", {
      createFiles: { publicImage: fixtures.ref, publicVideo: fixtures.video },
      segments: [
        {
          index: 1,
          prompt: `${SEG1}\nUse <Picture 1> as identity. Match motion from <Video 1>.`,
          seed: 71,
          expect: {
            h3Class: "MiniMaxH3ReferenceToVideo",
            images: 1,
            videos: 1,
            audios: 0,
          },
        },
        {
          index: 2,
          prompt: `${SEG2}\nKeep <Picture 1> and continue <Video 1>.`,
          seed: 72,
          expect: {
            h3Class: "MiniMaxH3ReferenceToVideo",
            images: 1,
            videos: 1,
            audios: 0,
          },
        },
      ],
    })
  )
  report.workflows.push(
    await runTwoSegments("FLF first+last then motion context only", "h3-flf-long.json", {
      createFiles: {},
      segments: [
        {
          index: 1,
          prompt: SEG1,
          seed: 81,
          firstFrame: fixtures.first,
          lastFrame: fixtures.last,
          expect: { firstFrame: true, lastFrame: true, h3Class: "MiniMaxH3ImageToVideo" },
        },
        {
          index: 2,
          prompt: SEG2,
          seed: 82,
          expect: { firstFrame: false, lastFrame: false, h3Class: "MiniMaxH3ImageToVideo" },
        },
      ],
    })
  )
  report.workflows.push(await runRewrite())

  report.finishedAt = new Date().toISOString()
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  const failed = report.workflows.some((item) => item.status !== "PASS")
  if (failed) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

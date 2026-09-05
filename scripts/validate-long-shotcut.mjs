#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

const STUDIO = process.env.STUDIO_URL ?? "http://127.0.0.1:17333"
const LOCK = "A woman in a crimson jacket and short black hair, daylight, handheld camera."
const SEG1 =
  "subject_definitions: Woman in crimson jacket\nsummary: She walks down an empty street.\nintegrated_multimodal_description: She walks toward camera and glances left.\noverall_soundscape: footsteps, distant traffic\nnon_diegetic_music: N/A"
const CUT2 =
  "subject_definitions: Woman in crimson jacket\nsummary: Hard cut to a close-up of her face at a cafe window.\nintegrated_multimodal_description: Sudden new shot: close-up, she looks out a cafe window at dusk.\noverall_soundscape: cafe murmur\nnon_diegetic_music: N/A"

async function api(pathname, init) {
  const response = await fetch(`${STUDIO}${pathname}`, init)
  const json = await response.json()
  return { ok: response.ok, status: response.status, json }
}

async function waitForSegment(jobId, index) {
  const started = Date.now()
  while (Date.now() - started < 45 * 60 * 1000) {
    const { json } = await api(`/api/jobs/${jobId}`)
    const segment = json.job?.long?.segments?.find((item) => item.index === index)
    if (!segment) throw new Error(`segment ${index} missing`)
    if (segment.status === "success") return json.job
    if (segment.status === "error" || segment.status === "interrupted") {
      throw new Error(segment.error || json.job?.error || `segment ${index} ${segment.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  throw new Error(`timeout waiting for segment ${index}`)
}

function inspect(workflow, clipIndex, jobId, shotCut) {
  const byClass = (classType) =>
    Object.entries(workflow).find(([, node]) => node.class_type === classType)
  const load = byClass("MiniMaxH3MotionContextLoadLatent")
  const motion = byClass("MiniMaxH3MotionContext")
  const save = byClass("MiniMaxH3MotionContextSaveLatent")
  const issues = []
  if (!save) issues.push("missing Save")
  if (save && save[1].inputs.clip_index !== clipIndex) issues.push("save clip wrong")
  if (shotCut || clipIndex <= 1) {
    if (load) issues.push("shot-cut loaded previous latent")
    if (motion) issues.push("shot-cut used Motion Context")
  } else if (!load || !motion) issues.push("continuous segment missing MC")
  return { ok: issues.length === 0, issues, load: Boolean(load), motion: Boolean(motion) }
}

async function submit(jobId, options) {
  const form = new FormData()
  form.set("prompt", options.prompt)
  form.set("duration", "5")
  form.set("aspect", "16:9")
  form.set("megapixels", "0.4")
  form.set("steps", "16")
  form.set("seed", String(options.seed))
  if (options.shotCut) form.set("shotCut", "true")
  const { ok, status, json } = await api(`/api/jobs/${jobId}/segments`, { method: "POST", body: form })
  if (!ok) throw new Error(`segment ${status}: ${json.error ?? JSON.stringify(json)}`)
  return json.job
}

async function snapshot(jobId, index, suffix) {
  const { ok, json, status } = await api(`/api/jobs/${jobId}/workflow`)
  if (!ok) throw new Error(`workflow ${status}`)
  const dest = path.join(process.cwd(), "outputs", jobId, `workflow-seg${String(index).padStart(3, "0")}${suffix}.json`)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, `${JSON.stringify(json, null, 2)}\n`)
  return { dest, workflow: json }
}

async function main() {
  await api("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resume" }),
  })
  const create = new FormData()
  create.set("kind", "long")
  create.set("workflowFile", "h3-t2v-long.json")
  create.set("lockPrompt", LOCK)
  create.set("aspect", "16:9")
  create.set("megapixels", "0.4")
  const created = await api("/api/jobs", { method: "POST", body: create })
  if (!created.ok) throw new Error(`create ${created.status}: ${JSON.stringify(created.json)}`)
  const jobId = created.json.job.id
  console.error(`[shot-cut] job=${jobId}`)
  await submit(jobId, { prompt: SEG1, seed: 121 })
  await waitForSegment(jobId, 1)
  const snap1 = await snapshot(jobId, 1, "")
  const graph1 = inspect(snap1.workflow, 1, jobId, false)
  await submit(jobId, { prompt: CUT2, seed: 122, shotCut: true })
  const afterCut = await api(`/api/jobs/${jobId}`)
  if (!afterCut.json.job?.long?.segments?.find((item) => item.index === 2)?.shotCut) {
    throw new Error("shotCut was not stored on segment 2")
  }
  await waitForSegment(jobId, 2)
  const snap2 = await snapshot(jobId, 2, "")
  const graph2 = inspect(snap2.workflow, 2, jobId, true)
  const latest = await api(`/api/jobs/${jobId}`)
  const report = {
    label: "T2V shot-cut segment 2",
    jobId,
    status: graph1.ok && graph2.ok && latest.json.job?.long?.stitchedFile ? "PASS" : "FAIL",
    graph1,
    graph2,
    stitch: latest.json.job?.long?.stitchedFile,
  }
  console.log(JSON.stringify(report, null, 2))
  if (report.status !== "PASS") process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

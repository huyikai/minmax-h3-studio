import { randomUUID } from "node:crypto"
import { ASPECT_PRESETS } from "@/lib/types"
import type { Job, LoraFormValue } from "@/lib/types"
import { getActiveJob, listJobs, toPublicJob, upsertJob } from "@/lib/jobs"
import { readSettings, writeSettings } from "@/lib/settings"
import { getHealth, newClientId, submitPrompt, uploadInputFile } from "@/lib/comfy"
import { applyPatch, parseApiWorkflow, type MediaPatch } from "@/lib/workflow-core"
import { readWorkflowBundle, readWorkflowFile } from "@/lib/workflow-service"
import { ensureJobWatch, writeSubmittedWorkflow } from "@/lib/runner"

export const dynamic = "force-dynamic"

export async function GET() {
  const jobs = await listJobs()
  for (const job of jobs) {
    if (job.status === "queued" || job.status === "running") {
      ensureJobWatch(job.id)
    }
  }
  return Response.json({ jobs: jobs.map(toPublicJob) })
}

export async function POST(request: Request) {
  const form = await request.formData()
  const workflowFile = String(form.get("workflowFile") ?? "")
  const prompt = String(form.get("prompt") ?? "").trim()
  const duration = Number(form.get("duration") ?? 5)
  const aspect = String(form.get("aspect") ?? "16:9")
  const seed = Number(form.get("seed") ?? 1)
  const ignoreBusy = String(form.get("ignoreBusy") ?? "") === "true"
  const stepsRaw = form.get("steps")
  const cfgRaw = form.get("cfg")
  const loras = parseLoras(String(form.get("loras") ?? "[]"))

  if (!workflowFile) {
    return Response.json({ error: "请先选择一份工作流" }, { status: 400 })
  }
  if (!prompt) {
    return Response.json({ error: "请填写提示词" }, { status: 400 })
  }

  const preset =
    ASPECT_PRESETS.find((item) => item.id === aspect) ?? ASPECT_PRESETS[0]

  const active = await getActiveJob()
  if (active) {
    return Response.json(
      {
        error: "已有任务正在进行",
        code: "studio_busy",
        jobId: active.id,
      },
      { status: 409 }
    )
  }

  const health = await getHealth()
  if (!health.ok) {
    return Response.json(
      { error: health.error ?? "无法连接 ComfyUI", code: "comfy_down" },
      { status: 503 }
    )
  }
  if (health.queueRemaining > 0 && !ignoreBusy) {
    return Response.json(
      {
        error: "ComfyUI 队列里已有任务",
        code: "comfy_busy",
        queueRemaining: health.queueRemaining,
      },
      { status: 409 }
    )
  }

  const settings = await readSettings()
  const bundle = await readWorkflowBundle(workflowFile)
  const { data } = await readWorkflowFile(workflowFile)
  const workflow = parseApiWorkflow(data)

  const media: MediaPatch[] = []
  const mediaNames: string[] = []
  let firstFrameName: string | undefined
  let lastFrameName: string | undefined

  for (const slot of bundle.mapping.media ?? []) {
    const raw = form.get(`media:${slot.id}`)
    if (!(raw instanceof File) || raw.size <= 0) continue
    const bytes = Buffer.from(await raw.arrayBuffer())
    const filename = await uploadInputFile({
      filename: raw.name || `${slot.id}.bin`,
      bytes,
      contentType: raw.type || "application/octet-stream",
    }, `上传${slot.label}失败`)
    media.push({ slotId: slot.id, filename })
    mediaNames.push(raw.name)
    if (slot.role === "firstFrame") firstFrameName = raw.name
    if (slot.role === "lastFrame") lastFrameName = raw.name
  }

  const patched = applyPatch(workflow, bundle.mapping, {
    prompt,
    duration,
    width: preset.width,
    height: preset.height,
    seed: Number.isFinite(seed) ? seed : Math.floor(Math.random() * 1_000_000_000),
    media,
    loras,
    steps: stepsRaw ? Number(stepsRaw) : bundle.values.steps,
    cfg: cfgRaw ? Number(cfgRaw) : bundle.values.cfg,
  })

  const jobId = randomUUID()
  const clientId = newClientId()
  const submittedPath = await writeSubmittedWorkflow(jobId, patched)

  const job: Job = {
    id: jobId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "queued",
    workflowFile,
    prompt,
    duration,
    aspect: preset.id,
    width: preset.width,
    height: preset.height,
    seed: Number.isFinite(seed) ? seed : 0,
    firstFrameName,
    lastFrameName,
    mediaNames: mediaNames.length ? mediaNames : undefined,
    loras,
    steps: stepsRaw ? Number(stepsRaw) : bundle.values.steps,
    cfg: cfgRaw ? Number(cfgRaw) : bundle.values.cfg,
    clientId,
    submittedWorkflowFile: submittedPath,
  }

  await upsertJob(job)

  try {
    const promptId = await submitPrompt(patched, clientId)
    const running = await upsertJob({
      ...job,
      status: "running",
      comfyPromptId: promptId,
    })
    ensureJobWatch(running.id)
    if (settings.defaultWorkflow !== workflowFile) {
      await writeSettings({ ...settings, defaultWorkflow: workflowFile })
    }
    return Response.json({ job: toPublicJob(running) })
  } catch (error) {
    const failed = await upsertJob({
      ...job,
      status: "error",
      error: error instanceof Error ? error.message : "提交失败",
    })
    return Response.json(
      { job: toPublicJob(failed), error: failed.error },
      { status: 502 }
    )
  }
}

function parseLoras(raw: string): LoraFormValue[] {
  try {
    const parsed = JSON.parse(raw) as LoraFormValue[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

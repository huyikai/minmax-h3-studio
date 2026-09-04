import { randomUUID } from "node:crypto"
import { ASPECT_PRESETS } from "@/lib/types"
import { resolutionFor, resolutionPreset } from "@/lib/resolution"
import type { Job, LoraFormValue } from "@/lib/types"
import { normalizeLora } from "@/lib/lora"
import { listJobs, removeJobs, toPublicJob, upsertJob, getJob } from "@/lib/jobs"
import { evaluateEnvironment, environmentLineFor, evaluateLongWorkflowEnvironment } from "@/lib/environment"
import { emptyLongState, LONG_T2V_FILE, longWorkflowIncompatibility, longWorkflowInputFlags } from "@/lib/long-video"
import { longWorkflowCapabilities } from "@/lib/default-workflows"
import { persistLongMedia, persistUploadedMedia } from "@/lib/job-media"
import { validateLongCreateMedia } from "@/lib/long-media"
import { afterEnqueue, ensureBootPause, pumpQueue, queueSnapshot } from "@/lib/studio-queue"
import { newClientId } from "@/lib/comfy"
import { readWorkflowBundle } from "@/lib/workflow-service"
import { ensureJobWatch } from "@/lib/runner"

export const dynamic = "force-dynamic"

export async function GET() {
  await ensureBootPause()
  void pumpQueue()
  const jobs = await listJobs()
  for (const job of jobs) {
    if (job.status === "queued" || job.status === "running") {
      ensureJobWatch(job.id)
    }
  }
  return Response.json({
    jobs: jobs.map(toPublicJob),
    queue: await queueSnapshot(jobs),
  })
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { ids?: unknown }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : []
  if (ids.length === 0) {
    return Response.json({ error: "请选择要删除的任务" }, { status: 400 })
  }
  const result = await removeJobs(ids)
  await pumpQueue()
  if (result.deleted.length === 0 && result.skipped.length > 0) {
    return Response.json(
      { error: "进行中的任务不能删除，请先中断。", ...result },
      { status: 409 }
    )
  }
  return Response.json(result)
}

export async function POST(request: Request) {
  const form = await request.formData()
  if (String(form.get("kind") ?? "") === "long") {
    return createLongJob(form)
  }

  const workflowFile = String(form.get("workflowFile") ?? "")
  const prompt = String(form.get("prompt") ?? "").trim()
  const duration = Number(form.get("duration") ?? 5)
  const aspect = String(form.get("aspect") ?? "16:9")
  const megapixels = resolutionPreset(form.get("megapixels")) ?? 0.98
  const seed = Number(form.get("seed") ?? 1)
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
  const resolution = resolutionFor(preset.id, megapixels)

  const line = environmentLineFor(workflowFile)
  const env = await evaluateEnvironment(line)
  if (!env.ready) {
    return Response.json(
      { error: env.summary, code: "environment_incomplete", gaps: env.gaps },
      { status: 412 }
    )
  }

  const bundle = await readWorkflowBundle(workflowFile)
  const jobId = randomUUID()
  const now = new Date().toISOString()

  let inputMedia
  let mediaNames: string[]
  let firstFrameName: string | undefined
  let lastFrameName: string | undefined
  try {
    const collected = await persistUploadedMedia(jobId, form, bundle.mapping)
    inputMedia = collected.inputMedia
    mediaNames = collected.mediaNames
    firstFrameName = collected.firstFrameName
    lastFrameName = collected.lastFrameName
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "参考文件无效" },
      { status: 400 }
    )
  }

  const job: Job = {
    id: jobId,
    createdAt: now,
    updatedAt: now,
    status: "waiting",
    kind: "short",
    workflowFile,
    prompt,
    duration,
    aspect: preset.id,
    megapixels,
    width: resolution.width,
    height: resolution.height,
    seed: Number.isFinite(seed) ? seed : Math.floor(Math.random() * 1_000_000_000),
    firstFrameName,
    lastFrameName,
    mediaNames: mediaNames.length ? mediaNames : undefined,
    loras,
    steps: stepsRaw ? Number(stepsRaw) : bundle.values.steps,
    cfg: cfgRaw ? Number(cfgRaw) : bundle.values.cfg,
    clientId: newClientId(),
    enqueuedAt: now,
    inputMedia: inputMedia.length ? inputMedia : undefined,
  }

  await upsertJob(job)
  await afterEnqueue()
  const current = (await getJob(jobId)) ?? job
  return Response.json({
    job: toPublicJob(current),
    queue: await queueSnapshot(),
  })
}

async function createLongJob(form: FormData) {
  const workflowFile = String(form.get("workflowFile") || LONG_T2V_FILE)
  const capabilities = longWorkflowCapabilities(workflowFile)
  if (!capabilities?.motionContext) {
    return Response.json({ error: "请选择包含 Motion Context 的长视频工作流" }, { status: 400 })
  }
  const aspect = String(form.get("aspect") ?? "16:9")
  const megapixels = resolutionPreset(form.get("megapixels")) ?? 0.98
  const lockPrompt = String(form.get("lockPrompt") ?? "")
  const jobId = randomUUID()
  let publicLockRefs
  try {
    const collected = await persistLongMedia(jobId, form, {
      scope: "public",
      capabilities,
    })
    if (collected.firstFrame || collected.lastFrame) {
      return Response.json({ error: "公共锁定区只接受参考元素，不要上传首帧或尾帧" }, { status: 400 })
    }
    publicLockRefs = collected.refs
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "公共参考无效" },
      { status: 400 }
    )
  }
  const mediaError = validateLongCreateMedia({
    workflowFile,
    publicRefs: publicLockRefs,
  })
  if (mediaError) {
    return Response.json({ error: mediaError }, { status: 400 })
  }
  const incompatible = longWorkflowIncompatibility(
    workflowFile,
    longWorkflowInputFlags({ publicRefs: publicLockRefs })
  )
  if (incompatible) {
    return Response.json({ error: incompatible }, { status: 400 })
  }
  const env = await evaluateLongWorkflowEnvironment(workflowFile)
  if (!env.ready) {
    return Response.json(
      { error: env.summary, code: "environment_incomplete", gaps: env.gaps },
      { status: 412 }
    )
  }
  const preset =
    ASPECT_PRESETS.find((item) => item.id === aspect) ?? ASPECT_PRESETS[0]
  const resolution = resolutionFor(preset.id, megapixels)
  const now = new Date().toISOString()
  const long = emptyLongState(lockPrompt, workflowFile)
  const job: Job = {
    id: jobId,
    createdAt: now,
    updatedAt: now,
    status: "awaiting",
    kind: "long",
    workflowFile,
    prompt: "",
    duration: 0,
    aspect: preset.id,
    megapixels,
    width: resolution.width,
    height: resolution.height,
    steps: 20,
    seed: 0,
    loras: [],
    clientId: newClientId(),
    mediaNames: publicLockRefs.map((item) => item.originalName),
    inputMedia: publicLockRefs,
    long: {
      ...long,
      publicLockRefs,
      lockFrozen: true,
    },
  }
  const saved = await upsertJob(job)
  return Response.json({ job: toPublicJob(saved) })
}

function parseLoras(raw: string): LoraFormValue[] {
  try {
    const parsed = JSON.parse(raw) as LoraFormValue[]
    return Array.isArray(parsed) ? parsed.map(normalizeLora) : []
  } catch {
    return []
  }
}

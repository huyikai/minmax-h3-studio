import type { Job } from "@/lib/types"
import { getJob, upsertJob } from "@/lib/jobs"
import { newClientId, submitPrompt } from "@/lib/comfy"
import { applyH3UnetName, applyPatch, parseApiWorkflow } from "@/lib/workflow-core"
import { readWorkflowBundle, readWorkflowFile } from "@/lib/workflow-service"
import { ensureJobWatch, writeSubmittedWorkflow } from "@/lib/runner"
import { readSettings, writeSettings } from "@/lib/settings"
import { fl2vaFile } from "@/lib/h3-models"
import { isLongJob, patchLongChain, waitingSegment, canDispatchLongSegment } from "@/lib/long-video"
import { uploadStoredMedia } from "@/lib/job-media"

export async function dispatchWaitingJob(job: Job, segmentIndex?: number) {
  const fresh = await getJob(job.id)
  if (!fresh) return
  if (isLongJob(fresh)) {
    if (fresh.status === "queued" || fresh.status === "running") return
    await dispatchLong(fresh, segmentIndex)
    return
  }
  if (fresh.status !== "waiting") return
  await dispatchShort(fresh)
}

async function dispatchShort(job: Job) {
  const settings = await readSettings()
  const bundle = await readWorkflowBundle(job.workflowFile)
  const { data } = await readWorkflowFile(job.workflowFile)
  const workflow = parseApiWorkflow(data)
  const media = await uploadStoredMedia(job.id, job.inputMedia ?? [])
  const patched = applyH3UnetName(
    applyPatch(workflow, bundle.mapping, {
      prompt: job.prompt,
      duration: job.duration,
      width: job.width,
      height: job.height,
      seed: job.seed,
      media,
      loras: job.loras,
      steps: job.steps ?? bundle.values.steps,
      cfg: job.cfg ?? bundle.values.cfg,
    }),
    fl2vaFile(settings.h3UnetPrecision).filename
  )
  const submittedPath = await writeSubmittedWorkflow(job.id, patched)
  const clientId = job.clientId || newClientId()
  const queued = await upsertJob({
    ...job,
    status: "queued",
    clientId,
    submittedWorkflowFile: submittedPath,
    error: undefined,
    startedAt: undefined,
    runElapsedMs: undefined,
  })
  try {
    const promptId = await submitPrompt(patched, clientId)
    const startedAt = new Date().toISOString()
    const running = await upsertJob({
      ...queued,
      status: "running",
      comfyPromptId: promptId,
      startedAt,
      runElapsedMs: undefined,
    })
    ensureJobWatch(running.id)
    if (settings.defaultWorkflow !== job.workflowFile) {
      await writeSettings({ ...settings, defaultWorkflow: job.workflowFile })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败"
    if (isComfyUnreachable(message)) {
      await upsertJob({ ...queued, status: "waiting", error: undefined })
      return
    }
    await upsertJob({
      ...queued,
      status: "error",
      error: message,
    })
    const { pumpQueue } = await import("@/lib/studio-queue")
    await pumpQueue()
  }
}

async function dispatchLong(job: Job, segmentIndex?: number) {
  const segment =
    typeof segmentIndex === "number"
      ? job.long?.segments.find(
          (item) => item.index === segmentIndex && item.status === "waiting"
        )
      : waitingSegment(job.long)
  if (!job.long || !segment) return
  if (!canDispatchLongSegment(job.long, segment.index)) return
  const settings = await readSettings()
  const bundle = await readWorkflowBundle(job.workflowFile)
  const { data } = await readWorkflowFile(job.workflowFile)
  const workflow = parseApiWorkflow(data)
  const patched = patchLongChain(
    applyH3UnetName(
      applyPatch(workflow, bundle.mapping, {
        prompt: segment.submittedPrompt,
        duration: segment.duration,
        width: job.width,
        height: job.height,
        seed: segment.seed,
        loras: [],
        steps: job.steps ?? 20,
      }),
      fl2vaFile(settings.h3UnetPrecision).filename
    ),
    {
      jobId: job.id,
      clipIndex: segment.index,
      loadPrevious: segment.index > 1,
    }
  )
  const submittedPath = await writeSubmittedWorkflow(job.id, patched)
  const clientId = job.clientId || newClientId()
  const queued = await upsertJob({
    ...job,
    status: "queued",
    clientId,
    submittedWorkflowFile: submittedPath,
    error: undefined,
    startedAt: undefined,
    runElapsedMs: undefined,
    comfyPromptId: undefined,
    progress: undefined,
    prompt: segment.prompt,
    duration: segment.duration,
    seed: segment.seed,
    long: {
      ...job.long,
      segments: job.long.segments.map((item) =>
        item.index === segment.index
          ? {
              ...item,
              status: "queued" as const,
              startedAt: undefined,
              runElapsedMs: undefined,
            }
          : item
      ),
    },
  })
  try {
    const promptId = await submitPrompt(patched, clientId)
    const startedAt = new Date().toISOString()
    const running = await upsertJob({
      ...queued,
      status: "running",
      comfyPromptId: promptId,
      startedAt,
      runElapsedMs: undefined,
      long: {
        ...queued.long!,
        segments: queued.long!.segments.map((item) =>
          item.index === segment.index
            ? {
                ...item,
                status: "running" as const,
                comfyPromptId: promptId,
                startedAt,
                runElapsedMs: undefined,
                error: undefined,
              }
            : item
        ),
      },
    })
    ensureJobWatch(running.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败"
    if (isComfyUnreachable(message)) {
      await upsertJob({
        ...queued,
        status: "waiting",
        long: {
          ...queued.long!,
          segments: queued.long!.segments.map((item) =>
            item.index === segment.index ? { ...item, status: "waiting" as const } : item
          ),
        },
      })
      return
    }
    await upsertJob({
      ...queued,
      status: "error",
      error: message,
      long: {
        ...queued.long!,
        segments: queued.long!.segments.map((item) =>
          item.index === segment.index
            ? { ...item, status: "error" as const, error: message }
            : item
        ),
      },
    })
    const { pumpQueue } = await import("@/lib/studio-queue")
    await pumpQueue()
  }
}

function isComfyUnreachable(message: string) {
  return /fetch|ECONNREFUSED|无法连接|aborted|network/i.test(message)
}

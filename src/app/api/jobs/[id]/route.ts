import { getJob, isActiveStatus, removeJob, toPublicJob, upsertJob } from "@/lib/jobs"
import { ensureJobWatch } from "@/lib/runner"
import { interrupt } from "@/lib/comfy"
import { withFrozenElapsed } from "@/lib/job-timing"
import { isLongJob } from "@/lib/long-video"
import { pumpQueue } from "@/lib/studio-queue"

export const dynamic = "force-dynamic"
export const maxDuration = 3600

export async function GET(
  _request: Request,
  context: RouteContext<"/api/jobs/[id]">
) {
  const { id } = await context.params
  const job = await getJob(id)
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 })
  if (isActiveStatus(job.status)) {
    ensureJobWatch(job.id)
  }
  return Response.json({ job: toPublicJob(job) })
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/jobs/[id]">
) {
  const { id } = await context.params
  const job = await getJob(id)
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 })
  if (isActiveStatus(job.status)) {
    try {
      await interrupt()
    } catch {
      // still mark interrupted
    }
    if (isLongJob(job) && job.long) {
      const frozen = withFrozenElapsed(job)
      const next = await upsertJob({
        ...frozen,
        status: "awaiting",
        error: undefined,
        long: {
          ...frozen.long!,
          segments: frozen.long!.segments.map((item) =>
            item.comfyPromptId === frozen.comfyPromptId ||
            item.status === "queued" ||
            item.status === "running"
              ? { ...item, status: "interrupted" as const, error: "已中断" }
              : item
          ),
        },
      })
      await pumpQueue()
      return Response.json({ job: toPublicJob(next) })
    }
    const next = await upsertJob({
      ...withFrozenElapsed(job),
      status: "interrupted",
      error: "已中断",
    })
    await pumpQueue()
    return Response.json({ job: toPublicJob(next) })
  }
  const deleted = await removeJob(id)
  if (!deleted) return Response.json({ error: "任务不存在" }, { status: 404 })
  await pumpQueue()
  return Response.json({ deleted: true })
}

import { getJob, isActiveStatus, removeJob, toPublicJob } from "@/lib/jobs"
import { ensureJobWatch } from "@/lib/runner"
import { stopActiveRun } from "@/lib/job-interrupt"
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
    const next = await stopActiveRun(job)
    await pumpQueue()
    return Response.json({ job: toPublicJob(next) })
  }
  const deleted = await removeJob(id)
  if (!deleted) return Response.json({ error: "任务不存在" }, { status: 404 })
  await pumpQueue()
  return Response.json({ deleted: true })
}

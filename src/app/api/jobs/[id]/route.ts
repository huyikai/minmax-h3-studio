import { getJob, toPublicJob, upsertJob } from "@/lib/jobs"
import { ensureJobWatch } from "@/lib/runner"
import { interrupt } from "@/lib/comfy"

export const dynamic = "force-dynamic"
export const maxDuration = 3600

export async function GET(
  _request: Request,
  context: RouteContext<"/api/jobs/[id]">
) {
  const { id } = await context.params
  const job = await getJob(id)
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 })
  if (job.status === "queued" || job.status === "running") {
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
  if (job.status === "queued" || job.status === "running") {
    try {
      await interrupt()
    } catch {
      // still mark interrupted
    }
    const next = await upsertJob({
      ...job,
      status: "interrupted",
      error: "已中断",
    })
    return Response.json({ job: toPublicJob(next) })
  }
  return Response.json({ job: toPublicJob(job) })
}

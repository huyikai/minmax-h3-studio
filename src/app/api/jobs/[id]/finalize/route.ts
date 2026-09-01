import { getJob, toPublicJob, upsertJob } from "@/lib/jobs"
import { isLongJob, lastSuccessfulSegment } from "@/lib/long-video"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: RouteContext<"/api/jobs/[id]/finalize">
) {
  const { id } = await context.params
  const job = await getJob(id)
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 })
  if (!isLongJob(job) || !job.long) {
    return Response.json({ error: "这不是长视频任务" }, { status: 400 })
  }
  if (job.status === "queued" || job.status === "running" || job.status === "waiting") {
    return Response.json({ error: "这一段还在生成或排队，不能定稿" }, { status: 409 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    finalized?: boolean
  }
  const finalized = body.finalized !== false

  if (finalized) {
    const last = lastSuccessfulSegment(job.long)
    if (!last) {
      return Response.json({ error: "还没有成功的片段，不能定稿" }, { status: 400 })
    }
    const next = await upsertJob({
      ...job,
      status: "success",
      outputFile: job.long.stitchedFile ?? last.outputFile,
      error: undefined,
      long: { ...job.long, finalized: true },
    })
    return Response.json({ job: toPublicJob(next) })
  }

  const last = lastSuccessfulSegment(job.long)
  if (!last?.outputFile) {
    return Response.json(
      {
        error:
          "撤销定稿后没有可接续的成片。上一镜潜变量如果也不在 ComfyUI output 里，不能从第 1 段静默重来。",
      },
      { status: 409 }
    )
  }

  const next = await upsertJob({
    ...job,
    status: "awaiting",
    outputFile: last.outputFile,
    long: { ...job.long, finalized: false },
  })
  return Response.json({ job: toPublicJob(next) })
}

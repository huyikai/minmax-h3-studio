import { getJob, toPublicJob, upsertJob } from "@/lib/jobs"
import { isLongJob, successfulSegments } from "@/lib/long-video"
import { stitchSegmentFiles } from "@/lib/stitch"

export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  context: RouteContext<"/api/jobs/[id]/stitch">
) {
  const { id } = await context.params
  const job = await getJob(id)
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 })
  if (!isLongJob(job) || !job.long) {
    return Response.json({ error: "这不是长视频任务" }, { status: 400 })
  }

  const files = successfulSegments(job.long)
    .map((item) => item.outputFile)
    .filter((file): file is string => Boolean(file))

  try {
    const stitchedFile = await stitchSegmentFiles(job.id, files)
    const next = await upsertJob({
      ...job,
      outputFile: job.long.finalized ? stitchedFile : job.outputFile,
      long: { ...job.long, stitchedFile, stitchError: undefined },
    })
    return Response.json({ job: toPublicJob(next) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "拼接失败"
    const next = await upsertJob({
      ...job,
      long: { ...job.long, stitchError: message },
    })
    return Response.json(
      { job: toPublicJob(next), error: message },
      { status: 500 }
    )
  }
}

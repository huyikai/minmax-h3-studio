import { resumeQueue, withdrawWaiting, queueSnapshot } from "@/lib/studio-queue"
import { toPublicJob } from "@/lib/jobs"

export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({ queue: await queueSnapshot() })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string
    jobId?: string
  }
  if (body.action === "resume") {
    const queue = await resumeQueue()
    return Response.json({ queue })
  }
  if (body.action === "withdraw") {
    const jobId = String(body.jobId ?? "")
    if (!jobId) {
      return Response.json({ error: "请指定任务" }, { status: 400 })
    }
    const result = await withdrawWaiting(jobId)
    if ("error" in result && result.error) {
      return Response.json({ error: result.error }, { status: result.status })
    }
    return Response.json({
      ...result,
      job: "job" in result && result.job ? toPublicJob(result.job) : undefined,
      queue: await queueSnapshot(),
    })
  }
  return Response.json({ error: "未知操作" }, { status: 400 })
}

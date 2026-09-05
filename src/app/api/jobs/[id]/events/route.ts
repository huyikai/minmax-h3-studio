import { getJob, toPublicJob } from "@/lib/jobs"
import { ensureJobWatch } from "@/lib/runner"

export const dynamic = "force-dynamic"
export const maxDuration = 3600

export async function GET(
  request: Request,
  context: RouteContext<"/api/jobs/[id]/events">
) {
  const { id } = await context.params
  const existing = await getJob(id)
  if (!existing) {
    return Response.json({ error: "任务不存在" }, { status: 404 })
  }
  ensureJobWatch(id)

  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream({
    start(controller) {
      let last = ""
      let ticking = false
      const tick = async () => {
        if (ticking) return
        ticking = true
        try {
          const job = await getJob(id)
          const payload = JSON.stringify({
            job: job ? toPublicJob(job) : null,
          })
          if (payload !== last) {
            last = payload
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
          }
          if (
            job &&
            (job.status === "success" ||
              job.status === "error" ||
              job.status === "interrupted" ||
              job.status === "awaiting")
          ) {
            if (timer) clearInterval(timer)
            controller.close()
          }
          if (job && (job.status === "queued" || job.status === "running")) {
            ensureJobWatch(id)
          }
        } finally {
          ticking = false
        }
      }
      void tick()
      timer = setInterval(() => {
        void tick()
      }, 400)
      request.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer)
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      if (timer) clearInterval(timer)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

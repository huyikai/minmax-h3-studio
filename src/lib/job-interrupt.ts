import type { Job } from "@/lib/types"
import { interrupt } from "@/lib/comfy"
import { upsertJob } from "@/lib/jobs"
import { withFrozenElapsed } from "@/lib/job-timing"
import { isLongJob } from "@/lib/long-video"

export async function stopActiveRun(job: Job): Promise<Job> {
  if (job.status !== "queued" && job.status !== "running") return job
  try {
    await interrupt()
  } catch {
    // still mark interrupted
  }
  const frozen = withFrozenElapsed(job)
  if (isLongJob(frozen) && frozen.long) {
    return upsertJob({
      ...frozen,
      status: "awaiting",
      error: undefined,
      long: {
        ...frozen.long,
        segments: frozen.long.segments.map((item) =>
          item.comfyPromptId === frozen.comfyPromptId ||
          item.status === "queued" ||
          item.status === "running"
            ? { ...item, status: "interrupted" as const, error: "已中断" }
            : item
        ),
      },
    })
  }
  return upsertJob({
    ...frozen,
    status: "interrupted",
    error: "已中断",
  })
}

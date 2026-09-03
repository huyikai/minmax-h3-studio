import type { Job, JobStatus, PublicJob } from "@/lib/types"
import {
  chainBreakSegment,
  chainDeliveredSeconds,
  expectedLongSegmentIndex,
  formatApproxSeconds,
  isLongJob,
  lastSuccessfulSegment,
  lastWaitingSegment,
  runningLongSegment,
  successfulSegments,
} from "@/lib/long-video"

export { isLongJob }

export function isBusyJob(job: Pick<Job, "status">) {
  return job.status === "queued" || job.status === "running"
}

export function isWaitingJob(job: Pick<Job, "status">) {
  return job.status === "waiting"
}

export function statusLabel(job: Pick<Job, "status" | "kind">) {
  if (job.kind === "long" && job.status === "awaiting") return "待续"
  switch (job.status as JobStatus) {
    case "waiting":
      return "等待"
    case "queued":
      return "排队中"
    case "running":
      return "生成中"
    case "awaiting":
      return "待续"
    case "success":
      return "完成"
    case "error":
      return "失败"
    case "interrupted":
      return "已中断"
    default:
      return "未知"
  }
}

function resolutionMeta(job: PublicJob) {
  const pixels = `${job.width}×${job.height}`
  return job.megapixels !== undefined
    ? `${job.megapixels === 0.98 ? "0.98" : job.megapixels.toFixed(1)} MP · ${pixels}`
    : pixels
}

export function jobListMeta(job: PublicJob) {
  const resolution = resolutionMeta(job)
  if (job.kind === "long") {
    const count = successfulSegments(job.long).length
    const running = runningLongSegment(job.long)
    const broken = chainBreakSegment(job.long)
    const current = running?.index ?? broken?.index
    const expected = Math.max(1, expectedLongSegmentIndex(job.long))
    const approx = formatApproxSeconds(chainDeliveredSeconds(job.long))
    return [
      `已做 ${count} 段`,
      current ? `当前第 ${current} 段` : `预计到第 ${expected} 段`,
      approx,
      job.aspect,
      resolution,
    ]
  }
  return [`${job.duration}s`, job.aspect, resolution]
}

export function jobListFailure(job: PublicJob) {
  if (job.kind === "long") {
    const broken = chainBreakSegment(job.long)
    if (broken) return `失败：第 ${broken.index} 段 ${broken.error ?? "生成失败"}`
  }
  if (job.status === "error" || job.status === "interrupted") {
    return `${statusLabel(job)}：${job.error ?? "没有错误详情"}`
  }
  return undefined
}

export function jobListPrompt(job: PublicJob) {
  if (job.kind === "long") {
    const broken = chainBreakSegment(job.long)
    if (broken) return broken.prompt || "（长视频）"
    const waiting = lastWaitingSegment(job.long)
    if (waiting) return waiting.prompt || "（长视频）"
    const last = lastSuccessfulSegment(job.long)
    return last?.prompt || job.prompt || job.long?.lockPrompt || "（长视频）"
  }
  return job.prompt || "（无提示词）"
}

export function jobPreviewUrl(job: PublicJob) {
  if (job.kind === "long") return job.previewUrl ?? job.outputUrl
  return job.outputUrl
}

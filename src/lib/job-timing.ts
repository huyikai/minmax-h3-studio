import type { Job, JobProgress, JobStatus, LongVideoState } from "@/lib/types"

export type TimingJob = {
  status: JobStatus
  kind?: Job["kind"]
  createdAt: string
  enqueuedAt?: string
  startedAt?: string
  runElapsedMs?: number
  long?: LongVideoState
}

export function elapsedMsSince(iso: string | undefined, now = Date.now()) {
  if (!iso) return 0
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, now - t)
}

export function formatClock(iso: string | undefined) {
  if (!iso) return ""
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ""
  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function progressPercent(progress?: JobProgress) {
  if (!progress?.max) return undefined
  return Math.min(100, Math.max(0, Math.round((progress.value / progress.max) * 100)))
}

export function readableNodeLabel(node: {
  class_type?: string
  _meta?: { title?: string }
}) {
  const title = node._meta?.title?.trim()
  if (
    title &&
    !/^\d+$/.test(title) &&
    !/^节点\s*\d+$/.test(title) &&
    !/^node\s*\d+$/i.test(title)
  ) {
    return title
  }
  const classType = node.class_type?.trim()
  return classType || undefined
}

export function displayNodeTitle(title?: string) {
  const text = title?.trim()
  if (!text) return "正在执行"
  if (/^节点\s*\d+$/.test(text) || /^\d+$/.test(text)) return "正在执行"
  return text
}

export function freezeJobElapsed(job: Job, now = Date.now()): {
  runElapsedMs?: number
  long?: LongVideoState
} {
  const runElapsedMs = job.startedAt
    ? elapsedMsSince(job.startedAt, now)
    : job.runElapsedMs
  if (!job.long) return { runElapsedMs }
  return {
    runElapsedMs,
    long: {
      ...job.long,
      segments: job.long.segments.map((item) => {
        if (item.status !== "running" || !item.startedAt) return item
        return {
          ...item,
          runElapsedMs: elapsedMsSince(item.startedAt, now),
        }
      }),
    },
  }
}

export function withFrozenElapsed(job: Job, now = Date.now()): Job {
  const frozen = freezeJobElapsed(job, now)
  return {
    ...job,
    runElapsedMs: frozen.runElapsedMs,
    long: frozen.long ?? job.long,
  }
}

export function waitStartedAt(job: TimingJob) {
  const active = job.long?.segments.find(
    (item) =>
      item.status === "waiting" ||
      item.status === "queued" ||
      item.status === "running"
  )
  return active?.enqueuedAt ?? job.enqueuedAt ?? job.createdAt
}

export function runStartedAt(job: TimingJob) {
  const running = job.long?.segments.find((item) => item.status === "running")
  return running?.startedAt ?? job.startedAt
}

export function currentSegmentElapsedMs(job: TimingJob, now = Date.now()) {
  const running = job.long?.segments.find((item) => item.status === "running")
  if (running?.startedAt) return elapsedMsSince(running.startedAt, now)
  if (typeof running?.runElapsedMs === "number") return running.runElapsedMs

  const failed = [...(job.long?.segments ?? [])]
    .reverse()
    .find((item) => item.status === "error" || item.status === "interrupted")
  if (typeof failed?.runElapsedMs === "number") return failed.runElapsedMs

  if (job.status === "running" && job.startedAt) {
    return elapsedMsSince(job.startedAt, now)
  }
  return job.runElapsedMs ?? 0
}

export function longRunElapsedMs(
  long: LongVideoState | undefined,
  now = Date.now()
) {
  let sum = 0
  for (const item of long?.segments ?? []) {
    if (item.status === "voided") continue
    if (item.status === "running" && item.startedAt) {
      sum += elapsedMsSince(item.startedAt, now)
    } else if (typeof item.runElapsedMs === "number") {
      sum += item.runElapsedMs
    }
  }
  return sum
}

export function shortElapsedMs(job: TimingJob, now = Date.now()) {
  if (job.status === "running" && job.startedAt) {
    return elapsedMsSince(job.startedAt, now)
  }
  if (typeof job.runElapsedMs === "number") return job.runElapsedMs
  return 0
}

export function monitorTimingItems(
  job: TimingJob,
  phase: "waiting" | "queued" | "running" | "failed",
  now = Date.now()
) {
  const long = job.kind === "long"
  const items: string[] = []
  if (phase === "waiting" || phase === "queued") {
    items.push(`已等待 ${formatElapsed(elapsedMsSince(waitStartedAt(job), now))}`)
    if (long) {
      const total = longRunElapsedMs(job.long, now)
      if (total > 0) items.push(`累计 ${formatElapsed(total)}`)
    }
    return items
  }

  const startIso = runStartedAt(job)
  if (startIso) items.push(`开始 ${formatClock(startIso)}`)
  if (long) {
    const segmentMs = currentSegmentElapsedMs(job, now)
    const totalMs = longRunElapsedMs(job.long, now)
    if (segmentMs > 0 || phase === "running") {
      items.push(`本段 ${formatElapsed(segmentMs)}`)
    }
    if (totalMs > 0 || phase === "running") {
      items.push(`累计 ${formatElapsed(totalMs)}`)
    }
    return items
  }

  const elapsed = shortElapsedMs(job, now)
  if (elapsed > 0 || phase === "running") {
    items.push(`已耗时 ${formatElapsed(elapsed)}`)
  }
  return items
}

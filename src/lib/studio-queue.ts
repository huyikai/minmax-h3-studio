import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import type { Job, StudioQueueItem, StudioQueueSnapshot } from "@/lib/types"
import { getHealth } from "@/lib/comfy"
import { getActiveJob, getJob, readJobs, upsertJob, removeJob } from "@/lib/jobs"
import {
  canDispatchLongSegment,
  isLongJob,
  lastWaitingSegment,
  waitingSegments,
} from "@/lib/long-video"
import { dataDir, queueStatePath } from "@/lib/paths"
import { dispatchWaitingJob } from "@/lib/dispatch-job"

const globalForQueue = globalThis as typeof globalThis & { __h3StudioBootId?: string }

function bootId() {
  if (!globalForQueue.__h3StudioBootId) {
    globalForQueue.__h3StudioBootId = randomUUID()
  }
  return globalForQueue.__h3StudioBootId
}

type QueueFile = {
  paused: boolean
  bootId: string
}

async function readQueueFile(): Promise<QueueFile> {
  try {
    const raw = await fs.readFile(queueStatePath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<QueueFile>
    return {
      paused: parsed.paused !== false,
      bootId: typeof parsed.bootId === "string" ? parsed.bootId : "",
    }
  } catch {
    return { paused: true, bootId: "" }
  }
}

async function writeQueueFile(next: QueueFile) {
  await fs.mkdir(dataDir(), { recursive: true })
  await fs.writeFile(queueStatePath(), `${JSON.stringify(next, null, 2)}\n`)
}

export async function ensureBootPause() {
  const current = bootId()
  const file = await readQueueFile()
  if (file.bootId !== current) {
    await writeQueueFile({ paused: true, bootId: current })
  }
}

export async function isQueuePaused() {
  await ensureBootPause()
  return (await readQueueFile()).paused
}

export async function setQueuePaused(paused: boolean) {
  await writeQueueFile({ paused, bootId: bootId() })
}

export type QueueEntry = {
  job: Job
  enqueuedAt: string
  segmentIndex?: number
  blocked?: boolean
}

export function waitingEntries(jobs: Job[]): QueueEntry[] {
  const entries: QueueEntry[] = []
  for (const job of jobs) {
    if (isLongJob(job)) {
      for (const segment of waitingSegments(job.long)) {
        entries.push({
          job,
          enqueuedAt: segment.enqueuedAt ?? job.enqueuedAt ?? job.updatedAt,
          segmentIndex: segment.index,
          blocked: !canDispatchLongSegment(job.long, segment.index),
        })
      }
      continue
    }
    if (job.status === "waiting") {
      entries.push({
        job,
        enqueuedAt: job.enqueuedAt ?? job.createdAt,
      })
    }
  }
  return entries.sort((a, b) => {
    if (a.enqueuedAt < b.enqueuedAt) return -1
    if (a.enqueuedAt > b.enqueuedAt) return 1
    return 0
  })
}

function itemFromEntry(
  entry: QueueEntry,
  state: StudioQueueItem["state"]
): StudioQueueItem {
  const segment =
    typeof entry.segmentIndex === "number"
      ? entry.job.long?.segments.find((item) => item.index === entry.segmentIndex)
      : undefined
  const prompt = isLongJob(entry.job)
    ? (segment?.prompt ?? entry.job.prompt)
    : entry.job.prompt
  return {
    jobId: entry.job.id,
    kind: isLongJob(entry.job) ? "long" : "short",
    state,
    label: isLongJob(entry.job)
      ? `长视频 · 第 ${entry.segmentIndex ?? "?"} 段`
      : "短片",
    prompt: prompt || "（无提示词）",
    enqueuedAt: entry.enqueuedAt,
    segmentIndex: entry.segmentIndex,
    blocked: entry.blocked,
  }
}

export async function queueSnapshot(jobs?: Job[]): Promise<StudioQueueSnapshot> {
  const paused = await isQueuePaused()
  const list = jobs ?? (await readJobs())
  const active = list.find((job) => job.status === "queued" || job.status === "running")
  const waiting = waitingEntries(list)
  const items: StudioQueueItem[] = []
  if (active) {
    const segment = active.long?.segments.find(
      (item) => item.status === "queued" || item.status === "running"
    )
    items.push({
      jobId: active.id,
      kind: isLongJob(active) ? "long" : "short",
      state: "running",
      label: isLongJob(active)
        ? `长视频 · 第 ${segment?.index ?? "?"} 段`
        : "短片",
      prompt: (isLongJob(active) ? segment?.prompt : active.prompt) || "（无提示词）",
      enqueuedAt: active.enqueuedAt ?? active.createdAt,
      segmentIndex: segment?.index,
    })
  }
  for (const entry of waiting) {
    items.push(itemFromEntry(entry, "waiting"))
  }
  return {
    paused,
    remaining: waiting.length,
    items,
  }
}

let pumpChain: Promise<void> = Promise.resolve()
const globalForPump = globalThis as typeof globalThis & {
  __h3StudioPump?: ReturnType<typeof setInterval>
}

export function ensureQueuePump() {
  if (globalForPump.__h3StudioPump) return
  globalForPump.__h3StudioPump = setInterval(() => {
    void pumpQueue()
  }, 2500)
}

export function pumpQueue() {
  ensureQueuePump()
  pumpChain = pumpChain.then(() => pumpQueueInner()).catch(() => undefined)
  return pumpChain
}

async function pumpQueueInner() {
  await ensureBootPause()
  if (await isQueuePaused()) return
  if (await getActiveJob()) return
  const health = await getHealth()
  if (!health.ok || health.queueRemaining > 0) return
  const waiting = waitingEntries(await readJobs())
  const head = waiting.find((entry) => !entry.blocked)
  if (!head) return
  try {
    await dispatchWaitingJob(head.job, head.segmentIndex)
  } catch {
    // Comfy 暂时交不上去时保持等待，下次再试。
  }
}

export async function afterEnqueue() {
  const waiting = waitingEntries(await readJobs())
  if (waiting.length === 1) {
    await setQueuePaused(false)
  }
  await pumpQueue()
}

export async function resumeQueue() {
  await setQueuePaused(false)
  await pumpQueue()
  return queueSnapshot()
}

export async function withdrawWaiting(jobId: string, segmentIndex?: number) {
  const job = await getJob(jobId)
  if (!job) return { error: "任务不存在", status: 404 as const }
  if (isLongJob(job) && job.long) {
    const last = lastWaitingSegment(job.long)
    if (!last) {
      return { error: "这条长视频没有未开始的段", status: 409 as const }
    }
    if (segmentIndex !== undefined && segmentIndex !== last.index) {
      return {
        error: "只能撤下最后一个还没开始的段。要砍中间请重写那一段。",
        status: 409 as const,
      }
    }
    const busy = job.status === "queued" || job.status === "running"
    const nextSegments = job.long.segments.filter((item) => item.index !== last.index)
    const stillLocked = nextSegments.some(
      (item) => item.status !== "voided" && item.index === 1
    )
    const next = await upsertJob({
      ...job,
      status: busy ? job.status : "awaiting",
      error: busy ? job.error : undefined,
      enqueuedAt: busy ? job.enqueuedAt : undefined,
      comfyPromptId: busy ? job.comfyPromptId : undefined,
      long: {
        ...job.long,
        aspectLocked: stillLocked,
        segments: nextSegments,
      },
    })
    await pumpQueue()
    return { job: next, withdrawn: "segment" as const }
  }
  if (job.status !== "waiting") {
    return { error: "只有等待中的任务能从队列撤下", status: 409 as const }
  }
  const deleted = await removeJob(jobId)
  if (!deleted) return { error: "任务不存在", status: 404 as const }
  await pumpQueue()
  return { withdrawn: "job" as const, jobId }
}

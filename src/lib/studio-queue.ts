import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import type { Job, StudioQueueItem, StudioQueueSnapshot } from "@/lib/types"
import { getHealth } from "@/lib/comfy"
import { getActiveJob, getJob, readJobs, upsertJob, removeJob } from "@/lib/jobs"
import { isLongJob, waitingSegment } from "@/lib/long-video"
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
}

export function waitingEntries(jobs: Job[]): QueueEntry[] {
  const entries: QueueEntry[] = []
  for (const job of jobs) {
    if (isLongJob(job)) {
      const segment = waitingSegment(job.long)
      if (!segment) continue
      entries.push({
        job,
        enqueuedAt: segment.enqueuedAt ?? job.enqueuedAt ?? job.updatedAt,
        segmentIndex: segment.index,
      })
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
  const segment = waitingSegment(entry.job.long)
  const prompt = isLongJob(entry.job)
    ? (segment?.prompt ?? entry.job.prompt)
    : entry.job.prompt
  return {
    jobId: entry.job.id,
    kind: isLongJob(entry.job) ? "long" : "short",
    state,
    label: isLongJob(entry.job)
      ? `长视频 · 第 ${entry.segmentIndex ?? segment?.index ?? "?"} 段`
      : "短片",
    prompt: prompt || "（无提示词）",
    enqueuedAt: entry.enqueuedAt,
    segmentIndex: entry.segmentIndex,
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

export function pumpQueue() {
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
  const head = waiting[0]
  if (!head) return
  try {
    await dispatchWaitingJob(head.job)
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

export async function withdrawWaiting(jobId: string) {
  const job = await getJob(jobId)
  if (!job) return { error: "任务不存在", status: 404 as const }
  if (isLongJob(job) && job.long) {
    const segment = waitingSegment(job.long)
    if (!segment) {
      return { error: "这条长视频不在队列里", status: 409 as const }
    }
    const busy = job.status === "queued" || job.status === "running"
    const next = await upsertJob({
      ...job,
      status: busy ? job.status : "awaiting",
      error: busy ? job.error : undefined,
      enqueuedAt: busy ? job.enqueuedAt : undefined,
      comfyPromptId: busy ? job.comfyPromptId : undefined,
      long: {
        ...job.long,
        segments: job.long.segments.filter((item) => item.status !== "waiting"),
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

import fs from "node:fs/promises"
import path from "node:path"
import type { Job, LongSegment, PublicJob } from "@/lib/types"
import { dataDir, jobOutputDir, jobsPath } from "@/lib/paths"
import { lastSuccessfulSegment, normalizeJob, successfulSegments } from "@/lib/long-video"

let jobsLock: Promise<unknown> = Promise.resolve()

function withJobsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = jobsLock.then(fn, fn)
  jobsLock = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function ensure() {
  await fs.mkdir(dataDir(), { recursive: true })
}

async function readJobsUnlocked(): Promise<Job[]> {
  await ensure()
  try {
    const raw = await fs.readFile(jobsPath(), "utf8")
    const parsed = JSON.parse(raw) as Job[]
    return Array.isArray(parsed) ? parsed.map(normalizeJob) : []
  } catch {
    return []
  }
}

async function writeJobsUnlocked(jobs: Job[]) {
  await ensure()
  const target = jobsPath()
  const tmp = `${target}.tmp`
  const payload = `${JSON.stringify(jobs, null, 2)}\n`
  await fs.writeFile(tmp, payload, "utf8")
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.copyFile(tmp, target)
      await fs.unlink(tmp).catch(() => undefined)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
  throw lastError
}

export async function readJobs(): Promise<Job[]> {
  return withJobsLock(() => readJobsUnlocked())
}

export async function getJob(id: string) {
  const jobs = await readJobs()
  return jobs.find((job) => job.id === id)
}

export async function upsertJob(job: Job) {
  return withJobsLock(async () => {
    const jobs = await readJobsUnlocked()
    const index = jobs.findIndex((item) => item.id === job.id)
    const next = { ...job, updatedAt: new Date().toISOString() }
    if (index >= 0) jobs[index] = next
    else jobs.unshift(next)
    await writeJobsUnlocked(jobs)
    return next
  })
}

export async function listJobs() {
  const jobs = await readJobs()
  return jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function isActiveStatus(status: Job["status"]) {
  return status === "queued" || status === "running"
}

export async function removeJob(id: string) {
  const result = await removeJobs([id])
  return result.deleted.includes(id)
}

export async function removeJobs(ids: string[]) {
  const wanted = new Set(ids.filter((id) => typeof id === "string" && id.length > 0))
  const { deleted, skipped } = await withJobsLock(async () => {
    const jobs = await readJobsUnlocked()
    const deleted: string[] = []
    const skipped: string[] = []
    const keep: Job[] = []
    for (const job of jobs) {
      if (!wanted.has(job.id)) {
        keep.push(job)
        continue
      }
      if (isActiveStatus(job.status)) {
        skipped.push(job.id)
        keep.push(job)
        continue
      }
      deleted.push(job.id)
    }
    if (deleted.length > 0) {
      await writeJobsUnlocked(keep)
    }
    return { deleted, skipped }
  })
  if (deleted.length > 0) {
    await Promise.all(
      deleted.map((id) => fs.rm(jobOutputDir(id), { recursive: true, force: true }))
    )
  }
  return { deleted, skipped }
}

export function activeJob(jobs: Job[]) {
  return jobs.find((job) => job.status === "queued" || job.status === "running")
}

export async function getActiveJob() {
  return activeJob(await readJobs())
}

function outputUrl(jobId: string, file: string | undefined, bust: string) {
  if (!file) return undefined
  return `/api/outputs/${jobId}/${path.basename(file)}?t=${encodeURIComponent(bust)}`
}

function segmentMediaBust(segment: LongSegment) {
  const file = segment.outputFile ? path.basename(segment.outputFile) : ""
  return `${segment.index}:${segment.startedAt ?? ""}:${segment.runElapsedMs ?? ""}:${file}`
}

function publicSegment(jobId: string, segment: LongSegment): LongSegment {
  return {
    ...segment,
    outputFile: segment.outputFile ? path.basename(segment.outputFile) : undefined,
    outputUrl: outputUrl(jobId, segment.outputFile, segmentMediaBust(segment)),
  }
}

export function toPublicJob(job: Job): PublicJob {
  const kind = job.kind ?? "short"
  const bust = job.updatedAt
  const lastSuccess = lastSuccessfulSegment(job.long)
  const previewFile = kind === "long" ? lastSuccess?.outputFile : job.outputFile
  const stitchedFile = kind === "long" ? job.long?.stitchedFile : undefined
  const outputFile =
    kind === "long" && job.long?.finalized
      ? (stitchedFile ?? previewFile)
      : previewFile
  const rest = { ...job }
  delete rest.inputMedia
  const stitchBust = successfulSegments(job.long)
    .map(segmentMediaBust)
    .join("|")
  const previewBust = lastSuccess ? segmentMediaBust(lastSuccess) : bust

  return {
    ...rest,
    kind,
    outputFile: outputFile ? path.basename(outputFile) : undefined,
    submittedWorkflowFile: job.submittedWorkflowFile
      ? "workflow.json"
      : undefined,
    previewUrl: outputUrl(job.id, previewFile, previewBust),
    stitchedUrl: outputUrl(job.id, stitchedFile, stitchBust || bust),
    outputUrl: outputUrl(
      job.id,
      outputFile,
      kind === "long" && job.long?.finalized
        ? stitchBust || previewBust
        : previewBust
    ),
    workflowUrl: `/api/jobs/${job.id}/workflow`,
    long: job.long
      ? {
          ...job.long,
          stitchedFile: job.long.stitchedFile
            ? path.basename(job.long.stitchedFile)
            : undefined,
          segments: job.long.segments.map((segment) =>
            publicSegment(job.id, segment)
          ),
        }
      : undefined,
  }
}

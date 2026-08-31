import fs from "node:fs/promises"
import path from "node:path"
import type { Job, PublicJob } from "@/lib/types"
import { dataDir, jobOutputDir, jobsPath } from "@/lib/paths"

async function ensure() {
  await fs.mkdir(dataDir(), { recursive: true })
}

export async function readJobs(): Promise<Job[]> {
  await ensure()
  try {
    const raw = await fs.readFile(jobsPath(), "utf8")
    const parsed = JSON.parse(raw) as Job[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeJobs(jobs: Job[]) {
  await ensure()
  const tmp = `${jobsPath()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(jobs, null, 2)}\n`, "utf8")
  await fs.rename(tmp, jobsPath())
}

export async function getJob(id: string) {
  const jobs = await readJobs()
  return jobs.find((job) => job.id === id)
}

export async function upsertJob(job: Job) {
  const jobs = await readJobs()
  const index = jobs.findIndex((item) => item.id === job.id)
  const next = { ...job, updatedAt: new Date().toISOString() }
  if (index >= 0) jobs[index] = next
  else jobs.unshift(next)
  await writeJobs(jobs)
  return next
}

export async function listJobs() {
  const jobs = await readJobs()
  return jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function isActiveStatus(status: Job["status"]) {
  return status === "queued" || status === "running"
}

export async function removeJob(id: string) {
  const jobs = await readJobs()
  const next = jobs.filter((job) => job.id !== id)
  if (next.length === jobs.length) return false
  await writeJobs(next)
  await fs.rm(jobOutputDir(id), { recursive: true, force: true })
  return true
}

export function activeJob(jobs: Job[]) {
  return jobs.find((job) => job.status === "queued" || job.status === "running")
}

export async function getActiveJob() {
  return activeJob(await readJobs())
}

export function toPublicJob(job: Job): PublicJob {
  return {
    ...job,
    outputFile: job.outputFile ? path.basename(job.outputFile) : undefined,
    submittedWorkflowFile: job.submittedWorkflowFile
      ? "workflow.json"
      : undefined,
    outputUrl: job.outputFile
      ? `/api/outputs/${job.id}/${path.basename(job.outputFile)}`
      : undefined,
    workflowUrl: `/api/jobs/${job.id}/workflow`,
  }
}

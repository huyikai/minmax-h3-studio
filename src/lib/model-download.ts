import fs from "node:fs"
import fsPromises from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import type { CatalogFile } from "@/lib/h3-models"
import { hfUrl } from "@/lib/h3-models"
import { dataDir } from "@/lib/paths"
import { readSettings } from "@/lib/settings"

export type DownloadProgress = {
  id: string
  filename: string
  dest: string
  bytes: number
  total: number
  status: "queued" | "downloading" | "complete" | "error"
  error?: string
}

type InternalJob = DownloadProgress & {
  file: CatalogFile
}

const jobs = new Map<string, InternalJob>()
let pumping = false

function statePath() {
  return path.join(dataDir(), "downloads.json")
}

async function persist() {
  await fsPromises.mkdir(dataDir(), { recursive: true })
  const list = [...jobs.values()].map(publicProgress)
  await fsPromises.writeFile(statePath(), `${JSON.stringify(list, null, 2)}\n`)
}

function publicProgress(job: InternalJob): DownloadProgress {
  return {
    id: job.id,
    filename: job.filename,
    dest: job.dest,
    bytes: job.bytes,
    total: job.total,
    status: job.status,
    error: job.error,
  }
}

export function listDownloads(): DownloadProgress[] {
  return [...jobs.values()].map(publicProgress)
}

export function activeDownloads() {
  return listDownloads().filter(
    (item) => item.status === "queued" || item.status === "downloading"
  )
}

export async function enqueueDownloads(files: CatalogFile[], destFor: (file: CatalogFile) => string) {
  for (const file of files) {
    const current = jobs.get(file.id)
    if (current?.status === "downloading" || current?.status === "queued") continue
    if (current?.status === "complete") continue
    jobs.set(file.id, {
      id: file.id,
      filename: file.filename,
      dest: destFor(file),
      bytes: 0,
      total: file.bytes,
      status: "queued",
      file,
    })
  }
  await persist()
  void pump()
}

async function pump() {
  if (pumping) return
  pumping = true
  try {
    for (const job of jobs.values()) {
      if (job.status === "queued" || job.status === "downloading") {
        await downloadOne(job)
      }
    }
  } finally {
    pumping = false
    await persist()
  }
}

async function downloadOne(job: InternalJob) {
  job.status = "downloading"
  const part = `${job.dest}.part`
  await fsPromises.mkdir(path.dirname(job.dest), { recursive: true })
  let start = 0
  try {
    const stat = await fsPromises.stat(part)
    start = stat.size
    job.bytes = start
  } catch {
    start = 0
  }

  const settings = await readSettings()
  const headers: Record<string, string> = {
    "User-Agent": "minmax-h3-studio",
  }
  if (settings.hfToken) headers.Authorization = `Bearer ${settings.hfToken}`
  if (start > 0) headers.Range = `bytes=${start}-`

  const response = await fetch(hfUrl(job.file), { headers, redirect: "follow" })
  if (response.status === 416) {
    await fsPromises.rename(part, job.dest)
    job.bytes = job.total
    job.status = "complete"
    return
  }
  if (!response.ok || !response.body) {
    job.status = "error"
    job.error = `下载失败（${response.status}）。可填写 Hugging Face token，或改走「登记已有目录」。`
    return
  }

  const totalHeader = response.headers.get("content-length")
  if (response.status === 206 && totalHeader) {
    job.total = start + Number(totalHeader)
  } else if (totalHeader) {
    job.total = Number(totalHeader)
  }

  const writable = fs.createWriteStream(part, { flags: start > 0 ? "a" : "w" })
  const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream)
  nodeStream.on("data", (chunk: Buffer) => {
    job.bytes += chunk.length
  })
  try {
    await pipeline(nodeStream, writable)
    await fsPromises.rename(part, job.dest)
    job.status = "complete"
    job.bytes = job.total
  } catch (error) {
    job.status = "error"
    job.error = error instanceof Error ? error.message : "下载中断"
  }
}

export async function restoreDownloads() {
  try {
    const raw = await fsPromises.readFile(statePath(), "utf8")
    const parsed = JSON.parse(raw) as DownloadProgress[]
    for (const item of parsed) {
      if (item.status === "complete") jobs.set(item.id, { ...item, file: { id: item.id, filename: item.filename, folder: "diffusion_models", hfPath: "", bytes: item.total } })
    }
  } catch {
    // ignore
  }
}

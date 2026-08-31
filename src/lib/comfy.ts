import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import WebSocket from "ws"
import { readSettings } from "@/lib/settings"
import { jobOutputDir } from "@/lib/paths"
import type { Job } from "@/lib/types"

const TIMEOUT_MS = 5000

export async function comfyBaseUrl() {
  const settings = await readSettings()
  return {
    http: `http://${settings.comfyHost}:${settings.comfyPort}`,
    ws: `ws://${settings.comfyHost}:${settings.comfyPort}`,
    host: settings.comfyHost,
    port: settings.comfyPort,
  }
}

async function comfyFetch(pathname: string, init?: RequestInit) {
  const { http } = await comfyBaseUrl()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${http}${pathname}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      cache: "no-store",
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

export async function getQueue() {
  const response = await comfyFetch("/queue")
  if (!response.ok) {
    throw new Error(`ComfyUI /queue ${response.status}`)
  }
  return (await response.json()) as {
    queue_running: unknown[]
    queue_pending: unknown[]
  }
}

export async function getHealth() {
  const { host, port } = await comfyBaseUrl()
  try {
    const queue = await getQueue()
    return {
      ok: true,
      host,
      port,
      queueRemaining: queue.queue_running.length + queue.queue_pending.length,
    }
  } catch (error) {
    return {
      ok: false,
      host,
      port,
      queueRemaining: 0,
      error:
        error instanceof Error
          ? error.message
          : "无法连接 ComfyUI，请确认本机服务已启动",
    }
  }
}

export async function listLoras() {
  const response = await comfyFetch("/models/loras")
  if (response.ok) {
    const data = (await response.json()) as unknown
    if (Array.isArray(data)) return data.filter((item) => typeof item === "string")
  }
  const info = await comfyFetch("/object_info/LoraLoaderModelOnly")
  if (!info.ok) return []
  const json = (await info.json()) as {
    LoraLoaderModelOnly?: {
      input?: { required?: { lora_name?: [string[]] } }
    }
  }
  return json.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] ?? []
}

export async function uploadImage(file: {
  filename: string
  bytes: Buffer
  contentType: string
}) {
  return uploadInputFile(file, "上传失败")
}

export async function uploadInputFile(
  file: {
    filename: string
    bytes: Buffer
    contentType: string
  },
  errorLabel = "上传失败"
) {
  const { http } = await comfyBaseUrl()
  const form = new FormData()
  const bytes = new Uint8Array(file.bytes)
  form.set(
    "image",
    new Blob([bytes], { type: file.contentType }),
    file.filename
  )
  form.set("overwrite", "true")
  form.set("type", "input")
  const response = await fetch(`${http}/upload/image`, {
    method: "POST",
    body: form,
  })
  if (!response.ok) {
    throw new Error(`${errorLabel}（${response.status}）`)
  }
  const json = (await response.json()) as {
    name: string
    subfolder?: string
    type?: string
  }
  return json.subfolder ? `${json.subfolder}/${json.name}` : json.name
}

export async function submitPrompt(prompt: Record<string, unknown>, clientId: string) {
  const response = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: clientId }),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(parseComfyError(text, response.status))
  }
  const json = JSON.parse(text) as { prompt_id: string; node_errors?: unknown }
  if (json.node_errors && Object.keys(json.node_errors as object).length > 0) {
    throw new Error(`工作流节点错误：${JSON.stringify(json.node_errors)}`)
  }
  return json.prompt_id
}

export async function interrupt() {
  await comfyFetch("/interrupt", { method: "POST" })
}

export async function getHistory(promptId: string) {
  const response = await comfyFetch(`/history/${encodeURIComponent(promptId)}`)
  if (!response.ok) return undefined
  const json = (await response.json()) as Record<
    string,
    {
      status?: { completed?: boolean; status_str?: string; messages?: unknown[] }
      outputs?: Record<string, Record<string, unknown>>
    }
  >
  return json[promptId]
}

type MediaFile = {
  filename: string
  subfolder?: string
  type?: string
}

export function findVideoOutput(
  outputs: Record<string, Record<string, unknown>> | undefined
): MediaFile | undefined {
  if (!outputs) return undefined
  const buckets = ["videos", "gifs", "images", "files"]
  const videoName = /\.(mp4|webm|mkv|mov)$/i
  for (const nodeOut of Object.values(outputs)) {
    for (const key of buckets) {
      const items = nodeOut[key]
      if (!Array.isArray(items)) continue
      for (const item of items) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as MediaFile).filename === "string" &&
          videoName.test((item as MediaFile).filename)
        ) {
          return item as MediaFile
        }
      }
    }
  }
  return undefined
}

export async function downloadView(file: MediaFile) {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder ?? "",
    type: file.type ?? "output",
  })
  const { http } = await comfyBaseUrl()
  const response = await fetch(`${http}/view?${params.toString()}`, {
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error(`读取成片失败（${response.status}）`)
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function saveJobOutput(job: Job, file: MediaFile) {
  const dir = jobOutputDir(job.id)
  await fs.mkdir(dir, { recursive: true })
  const bytes = await downloadView(file)
  const filename = path.basename(file.filename)
  const fullPath = path.join(dir, filename)
  await fs.writeFile(fullPath, bytes)
  return fullPath
}

function parseComfyError(text: string, status: number) {
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; node_errors?: unknown }
    if (json.error?.message) return json.error.message
    if (json.node_errors) return `节点错误：${JSON.stringify(json.node_errors)}`
  } catch {
    // ignore
  }
  return text || `ComfyUI 请求失败（${status}）`
}

export type ProgressEvent =
  | { type: "status"; queueRemaining: number }
  | { type: "progress"; value: number; max: number; node?: string }
  | { type: "executing"; node?: string }
  | { type: "error"; message: string }
  | { type: "complete" }

export function subscribeComfyProgress(
  clientId: string,
  promptId: string,
  onEvent: (event: ProgressEvent) => void
) {
  let socket: WebSocket | undefined
  let closed = false

  const start = async () => {
    const { ws } = await comfyBaseUrl()
    socket = new WebSocket(`${ws}/ws?clientId=${encodeURIComponent(clientId)}`)
    socket.on("message", (raw) => {
      if (closed) return
      if (typeof raw !== "string" && !Buffer.isBuffer(raw)) return
      const text = typeof raw === "string" ? raw : raw.toString("utf8")
      if (text.startsWith("{") === false) return
      try {
        const message = JSON.parse(text) as {
          type: string
          data?: Record<string, unknown>
        }
        const data = message.data ?? {}
        if (data.prompt_id && data.prompt_id !== promptId) return
        if (message.type === "status") {
          const status = data.status as
            | { exec_info?: { queue_remaining?: number } }
            | undefined
          onEvent({
            type: "status",
            queueRemaining: status?.exec_info?.queue_remaining ?? 0,
          })
        } else if (message.type === "progress") {
          onEvent({
            type: "progress",
            value: Number(data.value ?? 0),
            max: Number(data.max ?? 0),
            node: typeof data.node === "string" ? data.node : undefined,
          })
        } else if (message.type === "executing") {
          onEvent({
            type: "executing",
            node: typeof data.node === "string" ? data.node : undefined,
          })
        } else if (message.type === "execution_error") {
          const exception =
            typeof data.exception_message === "string"
              ? data.exception_message
              : "ComfyUI 执行失败"
          onEvent({ type: "error", message: exception })
        } else if (message.type === "execution_success") {
          onEvent({ type: "complete" })
        }
      } catch {
        // ignore malformed frames
      }
    })
    socket.on("error", () => {
      // polling in the job watcher still covers completion
    })
  }

  void start()

  return () => {
    closed = true
    socket?.close()
  }
}

export function newClientId() {
  return randomUUID()
}

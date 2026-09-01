#!/usr/bin/env node
/**
 * Fake ComfyUI HTTP + websocket server for UI development.
 * Not a real MiniMax H3 runtime.
 */
import http from "node:http"
import { Buffer } from "node:buffer"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"

const PORT = Number(process.env.MOCK_COMFY_PORT ?? 8188)
const clients = new Set()
const history = new Map()
const queue = { queue_running: [], queue_pending: [] }

const dir = path.dirname(fileURLToPath(import.meta.url))
const MP4 = fs.readFileSync(path.join(dir, "mock-output.mp4"))

const UNETS = [
  "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  "minimax_h3_fl2va_pruned_fp8_scaled.safetensors",
  "minimax_h3_fl2va_pruned_bf16.safetensors",
  "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  "minimax_h3_ref2va_pruned_fp8_scaled.safetensors",
  "minimax_h3_ref2va_pruned_bf16.safetensors",
]
const VAES = [
  "minimax_h3_video_vae_fp16.safetensors",
  "minimax_h3_audio_vae_fp32.safetensors",
]
const TEXT_ENCODERS = ["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"]
const LORAS = [
  "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
  "minimax_h3_turbo_v4_step600_ema.safetensors",
]

function mockNode(name) {
  if (name === "UNETLoader") {
    return { input: { required: { unet_name: [UNETS] } } }
  }
  if (name === "VAELoader") {
    return { input: { required: { vae_name: [VAES] } } }
  }
  if (name === "CLIPLoader") {
    return { input: { required: { clip_name: [TEXT_ENCODERS] } } }
  }
  if (name === "LoraLoaderModelOnly") {
    return { input: { required: { lora_name: [LORAS] } } }
  }
  return { input: { required: {} } }
}

const OBJECT_INFO = Object.fromEntries(
  [
    "MiniMaxH3ImageToVideo",
    "MiniMaxH3ReferenceToVideo",
    "MiniMaxH3MotionContext",
    "MiniMaxH3MotionContextTrim",
    "MiniMaxH3MotionContextSaveLatent",
    "MiniMaxH3MotionContextLoadLatent",
    "MiniMaxH3TurboLoRA",
    "MiniMaxH3TurboSampler",
    "UNETLoader",
    "VAELoader",
    "CLIPLoader",
    "LoraLoaderModelOnly",
  ].map((name) => [name, mockNode(name)])
)

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`)
  res.setHeader("Access-Control-Allow-Origin", "*")
  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  if (url.pathname === "/queue" && req.method === "GET") {
    json(res, queue)
    return
  }
  if (url.pathname === "/system_stats" && req.method === "GET") {
    json(res, { system: { os: "mock" } })
    return
  }
  if (url.pathname === "/models/loras" && req.method === "GET") {
    json(res, LORAS)
    return
  }
  if (url.pathname === "/models/diffusion_models" && req.method === "GET") {
    json(res, UNETS)
    return
  }
  if (url.pathname === "/models/vae" && req.method === "GET") {
    json(res, VAES)
    return
  }
  if (url.pathname === "/models/text_encoders" && req.method === "GET") {
    json(res, TEXT_ENCODERS)
    return
  }
  if (url.pathname === "/object_info" && req.method === "GET") {
    json(res, OBJECT_INFO)
    return
  }
  if (url.pathname.startsWith("/object_info/") && req.method === "GET") {
    const name = decodeURIComponent(url.pathname.slice("/object_info/".length))
    if (OBJECT_INFO[name]) {
      json(res, { [name]: OBJECT_INFO[name] })
      return
    }
    json(res, { [name]: mockNode(name) })
    return
  }
  if (url.pathname === "/upload/image" && req.method === "POST") {
    json(res, { name: "first-frame.png", subfolder: "", type: "input" })
    return
  }
  if (url.pathname === "/interrupt" && req.method === "POST") {
    json(res, { status: "interrupted" })
    return
  }
  if (url.pathname === "/prompt" && req.method === "POST") {
    const body = await readJson(req)
    const promptId = crypto.randomUUID()
    const clientId = body?.client_id ?? "mock"
    json(res, { prompt_id: promptId, number: 1 })
    void runFakeJob(promptId, clientId)
    return
  }
  if (url.pathname.startsWith("/history/") && req.method === "GET") {
    const id = url.pathname.slice("/history/".length)
    const item = history.get(id)
    json(res, item ? { [id]: item } : {})
    return
  }
  if (url.pathname === "/view" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": MP4.length })
    res.end(MP4)
    return
  }

  res.writeHead(404)
  res.end("not found")
})

const wss = new WebSocketServer({ server, path: "/ws" })
wss.on("connection", (socket) => {
  clients.add(socket)
  socket.send(
    JSON.stringify({
      type: "status",
      data: { status: { exec_info: { queue_remaining: 0 } } },
    })
  )
  socket.on("close", () => clients.delete(socket))
})

function broadcast(payload) {
  const text = JSON.stringify(payload)
  for (const client of clients) {
    if (client.readyState === 1) client.send(text)
  }
}

async function runFakeJob(promptId, clientId) {
  queue.queue_running = [[0, promptId]]
  broadcast({
    type: "status",
    data: { status: { exec_info: { queue_remaining: 1 } }, sid: clientId },
  })
  broadcast({ type: "execution_start", data: { prompt_id: promptId } })
  broadcast({
    type: "executing",
    data: { prompt_id: promptId, node: "131" },
  })
  for (let value = 1; value <= 8; value += 1) {
    await delay(180)
    broadcast({
      type: "progress",
      data: { prompt_id: promptId, node: "131", value, max: 8 },
    })
  }
  history.set(promptId, {
    status: { completed: true, status_str: "success" },
    outputs: {
      "9": {
        videos: [{ filename: "mock.mp4", subfolder: "", type: "output" }],
      },
    },
  })
  broadcast({ type: "execution_success", data: { prompt_id: promptId } })
  broadcast({
    type: "status",
    data: { status: { exec_info: { queue_remaining: 0 } } },
  })
  queue.queue_running = []
}

function json(res, data) {
  const text = JSON.stringify(data)
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(text)
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        resolve({})
      }
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock ComfyUI listening on http://127.0.0.1:${PORT}`)
})

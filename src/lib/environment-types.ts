import type { H3UnetPrecision } from "@/lib/types"

export type ModelFolder =
  | "diffusion_models"
  | "text_encoders"
  | "vae"
  | "loras"

export type EnvironmentLine = "short" | "long" | "turbo" | "reference"

export type EnvironmentGap = {
  id: string
  title: string
  detail: string
  auto: boolean
}

export type ModelRow = {
  id: string
  filename: string
  folder: ModelFolder
  hfPath: string
  bytes: number
  present: boolean
  required: boolean
}

export type DownloadProgress = {
  id: string
  filename: string
  dest: string
  bytes: number
  total: number
  status: "queued" | "downloading" | "complete" | "error"
  error?: string
}

export type EnvironmentStatus = {
  ready: boolean
  mock: boolean
  line: EnvironmentLine
  connected: boolean
  comfyHost: string
  comfyPort: number
  comfyMin: string
  h3NodeOk: boolean
  motionContext: { onDisk: boolean; inComfy: boolean }
  comfyRoot: {
    path: string
    ok: boolean
    customNodes?: string
    models?: string
    extraYaml?: string
    error?: string
    candidates: string[]
  }
  extraModelsDir: string
  extraPathsPreview: string | null
  extraPathsWritten: boolean
  extraDirOk: boolean
  extraDirError?: string
  precision: H3UnetPrecision
  unetName: string
  unetHelp: string
  models: ModelRow[]
  downloads: DownloadProgress[]
  gaps: EnvironmentGap[]
  restartNeeded: boolean
  disk: { free: number; need: number; ok: boolean }
  hfTokenSet: boolean
  summary: string
}

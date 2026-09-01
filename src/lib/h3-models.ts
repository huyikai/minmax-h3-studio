import type { H3UnetPrecision } from "@/lib/types"

export type { H3UnetPrecision }

export type ModelFolder =
  | "diffusion_models"
  | "text_encoders"
  | "vae"
  | "loras"

export type CatalogFile = {
  id: string
  filename: string
  folder: ModelFolder
  hfPath: string
  bytes: number
}

export const HF_REPO = "Comfy-Org/MiniMax-H3"
export const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`
export const COMFY_DOCS_H3 =
  "https://docs.comfy.org/zh/tutorials/video/minimax/minimax-h3"
export const COMFY_MIN_H3 = "0.34.0"

export const H3_UNET_PRECISION: Record<
  H3UnetPrecision,
  { label: string; help: string; fl2va: string; ref2va: string }
> = {
  int8: {
    label: "INT8 剪枝",
    help: "官方模板默认。体积相对小，和预设 JSON 里的 unet_name 一致。",
    fl2va: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    ref2va: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  },
  fp8: {
    label: "FP8 剪枝",
    help: "同样是剪枝权重，文件名不同。换档就是改工作流里 UNETLoader 的 unet_name。",
    fl2va: "minimax_h3_fl2va_pruned_fp8_scaled.safetensors",
    ref2va: "minimax_h3_ref2va_pruned_fp8_scaled.safetensors",
  },
  bf16: {
    label: "BF16 剪枝",
    help: "更大、更占显存。unet_name 会改成 pruned_bf16 那份，不是未剪枝的 60GB 满血档。",
    fl2va: "minimax_h3_fl2va_pruned_bf16.safetensors",
    ref2va: "minimax_h3_ref2va_pruned_bf16.safetensors",
  },
}

export const FIXED_MODELS = {
  clip: {
    id: "clip",
    filename: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    folder: "text_encoders" as const,
    hfPath: "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    bytes: 15_687_142_551,
  },
  videoVae: {
    id: "video_vae",
    filename: "minimax_h3_video_vae_fp16.safetensors",
    folder: "vae" as const,
    hfPath: "vae/minimax_h3_video_vae_fp16.safetensors",
    bytes: 5_207_808_496,
  },
  audioVae: {
    id: "audio_vae",
    filename: "minimax_h3_audio_vae_fp32.safetensors",
    folder: "vae" as const,
    hfPath: "vae/minimax_h3_audio_vae_fp32.safetensors",
    bytes: 605_254_808,
  },
} satisfies Record<string, CatalogFile>

const FL2VA_BYTES: Record<H3UnetPrecision, number> = {
  int8: 20_970_379_616,
  fp8: 20_958_205_608,
  bf16: 40_225_724_176,
}

const REF2VA_BYTES: Record<H3UnetPrecision, number> = {
  int8: 20_970_379_616,
  fp8: 20_958_205_608,
  bf16: 40_225_724_176,
}

export const TURBO_LORA_NAME = "minimax_h3_turbo_v4_step600_ema.safetensors"
export const TURBO_PACK_URL =
  "https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo"
export const TURBO_NODE_CLASSES = [
  "MiniMaxH3TurboLoRA",
  "MiniMaxH3TurboSampler",
] as const

export function isH3UnetPrecision(value: string): value is H3UnetPrecision {
  return value === "int8" || value === "fp8" || value === "bf16"
}

export function fl2vaFile(precision: H3UnetPrecision): CatalogFile {
  const filename = H3_UNET_PRECISION[precision].fl2va
  return {
    id: "fl2va",
    filename,
    folder: "diffusion_models",
    hfPath: `diffusion_models/${filename}`,
    bytes: FL2VA_BYTES[precision],
  }
}

export function ref2vaFile(precision: H3UnetPrecision): CatalogFile {
  const filename = H3_UNET_PRECISION[precision].ref2va
  return {
    id: "ref2va",
    filename,
    folder: "diffusion_models",
    hfPath: `diffusion_models/${filename}`,
    bytes: REF2VA_BYTES[precision],
  }
}

export function hfUrl(file: CatalogFile) {
  return `${HF_BASE}/${file.hfPath}`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

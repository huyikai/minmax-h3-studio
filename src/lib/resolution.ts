import {
  ASPECT_PRESETS,
  RESOLUTION_PRESETS,
  type ResolutionPreset,
} from "@/lib/types"

const NATIVE_AREA = 768 * 1344

export function resolutionFor(aspect: string, megapixels: number) {
  const preset = ASPECT_PRESETS.find((item) => item.id === aspect) ?? ASPECT_PRESETS[0]
  const totalPixels = megapixels * 1024 * 1024
  const scale = Math.sqrt(totalPixels / (preset.ratioWidth * preset.ratioHeight))
  const width = Math.max(32, Math.round((preset.ratioWidth * scale) / 32) * 32)
  const height = Math.max(32, Math.round((preset.ratioHeight * scale) / 32) * 32)

  return {
    megapixels,
    width,
    height,
    oversize: width * height > NATIVE_AREA,
  }
}

export function resolutionPreset(value: unknown): ResolutionPreset | undefined {
  const numeric = Number(value)
  return RESOLUTION_PRESETS.find((item) => item === numeric)
}

export function resolutionFromDimensions(
  aspect: string,
  width: number,
  height: number
): ResolutionPreset | undefined {
  return RESOLUTION_PRESETS.find((megapixels) => {
    const result = resolutionFor(aspect, megapixels)
    return result.width === width && result.height === height
  })
}

export function resolutionLoadHint(megapixels: number, oversize: boolean) {
  if (megapixels >= 2) {
    return "最高负载：显存和耗时压力最大，建议确认机器余量后再用，质量提升不保证。"
  }
  if (megapixels >= 1.5) {
    return "高负载：比原生画布更吃显存，生成更慢，显存不足可能失败。"
  }
  if (megapixels > 1 || oversize) {
    return "高于原生画布：显存和耗时会上升，细节提升不保证。"
  }
  return undefined
}

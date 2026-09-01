import fs from "node:fs/promises"
import type { H3UnetPrecision, Settings } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/types"
import { isH3UnetPrecision } from "@/lib/h3-models"
import { dataDir, settingsPath } from "@/lib/paths"

async function ensureDataDir() {
  await fs.mkdir(dataDir(), { recursive: true })
}

export async function readSettings(): Promise<Settings> {
  await ensureDataDir()
  try {
    const raw = await fs.readFile(settingsPath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      comfyHost: "127.0.0.1",
      comfyPort: Number(parsed.comfyPort) || DEFAULT_SETTINGS.comfyPort,
      mappings: parsed.mappings ?? {},
      comfyRoot: String(parsed.comfyRoot ?? ""),
      extraModelsDir: String(parsed.extraModelsDir ?? ""),
      h3UnetPrecision: isH3UnetPrecision(String(parsed.h3UnetPrecision ?? ""))
        ? (parsed.h3UnetPrecision as H3UnetPrecision)
        : "int8",
      hfToken: String(parsed.hfToken ?? ""),
    }
  } catch {
    return { ...DEFAULT_SETTINGS, mappings: {} }
  }
}

export async function writeSettings(next: Settings) {
  await ensureDataDir()
  const normalized: Settings = {
    ...DEFAULT_SETTINGS,
    ...next,
    comfyHost: "127.0.0.1",
    comfyPort: Number(next.comfyPort) || DEFAULT_SETTINGS.comfyPort,
    mappings: next.mappings ?? {},
    comfyRoot: String(next.comfyRoot ?? ""),
    extraModelsDir: String(next.extraModelsDir ?? ""),
    h3UnetPrecision: isH3UnetPrecision(String(next.h3UnetPrecision ?? ""))
      ? next.h3UnetPrecision
      : "int8",
    hfToken: String(next.hfToken ?? ""),
  }
  await fs.writeFile(
    settingsPath(),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8"
  )
  return normalized
}

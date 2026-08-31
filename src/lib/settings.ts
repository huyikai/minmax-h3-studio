import fs from "node:fs/promises"
import type { Settings } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/types"
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
  }
  await fs.writeFile(
    settingsPath(),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8"
  )
  return normalized
}

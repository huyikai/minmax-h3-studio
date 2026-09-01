import fs from "node:fs/promises"
import path from "node:path"
import type { ComfyLayout } from "@/lib/comfy-root"
import type { ModelFolder } from "@/lib/h3-models"

const MARK_START = "# --- h3_studio (MiniMax H3 Studio) ---"
const MARK_END = "# --- end h3_studio ---"
const BACKUP_NAME = "extra_model_paths.yaml.bak-h3-studio"

export function extraPathsBlock(basePath: string) {
  return `${MARK_START}
h3_studio:
    base_path: ${JSON.stringify(basePath)}
    diffusion_models: diffusion_models
    text_encoders: text_encoders
    vae: vae
    loras: loras
${MARK_END}
`
}

export function mergeExtraPaths(existing: string, basePath: string) {
  const block = extraPathsBlock(basePath)
  const start = existing.indexOf(MARK_START)
  if (start === -1) {
    const trimmed = existing.trimEnd()
    return `${trimmed ? `${trimmed}\n\n` : ""}${block}`
  }
  const end = existing.indexOf(MARK_END, start)
  if (end === -1) {
    return `${existing.trimEnd()}\n\n${block}`
  }
  return `${existing.slice(0, start)}${block}${existing.slice(end + MARK_END.length).replace(/^\n/, "")}`
}

export async function extraPathsAlreadyWritten(yamlPath: string, basePath: string) {
  try {
    const raw = await fs.readFile(yamlPath, "utf8")
    return raw.includes(MARK_START) && raw.includes(basePath)
  } catch {
    return false
  }
}

export async function writeExtraModelPaths(layout: ComfyLayout, basePath: string) {
  const yamlPath = layout.extraYaml
  let existing = ""
  try {
    existing = await fs.readFile(yamlPath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const backupPath = path.join(path.dirname(yamlPath), BACKUP_NAME)
  if (existing) {
    try {
      await fs.access(backupPath)
    } catch {
      await fs.writeFile(backupPath, existing, "utf8")
    }
  }
  const next = mergeExtraPaths(existing, basePath)
  await fs.writeFile(yamlPath, next, "utf8")
  return { yamlPath, backupPath: existing ? backupPath : undefined, preview: extraPathsBlock(basePath) }
}

const FOLDERS: ModelFolder[] = ["diffusion_models", "text_encoders", "vae", "loras"]

export async function extraDirHasFile(root: string, folder: ModelFolder, filename: string) {
  const nested = path.join(root, folder, filename)
  const flat = path.join(root, filename)
  try {
    await fs.access(nested)
    return true
  } catch {
    // continue
  }
  try {
    await fs.access(flat)
    return true
  } catch {
    return false
  }
}

export async function validateExtraModelsDir(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false as const, error: "还没有填写已有模型目录。" }
  try {
    const stat = await fs.stat(trimmed)
    if (!stat.isDirectory()) return { ok: false as const, error: "这不是文件夹。" }
  } catch {
    return { ok: false as const, error: "这个路径不存在，或者不是文件夹。" }
  }
  const hints = await Promise.all(
    FOLDERS.map(async (folder) => ({ folder, exists: await isDir(path.join(trimmed, folder)) }))
  )
  const hasLayout = hints.some((item) => item.exists)
  if (!hasLayout) {
    return {
      ok: false as const,
      error:
        "这里没有 diffusion_models / text_encoders / vae 子目录。请选已经按 Comfy 习惯分好文件夹的模型根目录。",
    }
  }
  return { ok: true as const, path: path.resolve(trimmed) }
}

async function isDir(target: string) {
  try {
    const stat = await fs.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

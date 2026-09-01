import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type ComfyLayout = {
  input: string
  comfyRoot: string
  customNodes: string
  models: string
  extraYaml: string
}

export type ComfyRootCheck = {
  ok: boolean
  input: string
  layout?: ComfyLayout
  error?: string
  candidates: string[]
}

async function isDir(target: string) {
  try {
    const stat = await fs.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function isFile(target: string) {
  try {
    const stat = await fs.stat(target)
    return stat.isFile()
  } catch {
    return false
  }
}

async function writable(target: string) {
  try {
    await fs.access(target, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function looksLikeAppBundle(target: string) {
  const resolved = path.resolve(target)
  return resolved.endsWith(".app") || resolved.includes(`${path.sep}.app${path.sep}`)
}

function homeCandidates() {
  const home = os.homedir()
  return [
    path.join(home, "Documents", "ComfyUI"),
    path.join(home, "ComfyUI"),
    path.join(home, "Library", "Application Support", "ComfyUI"),
    path.join(home, "Library", "Application Support", "ComfyUI", "ComfyUI"),
    path.join(home, "AppData", "Local", "Programs", "ComfyUI"),
    path.join(home, "AppData", "Roaming", "ComfyUI"),
  ]
}

export async function listComfyCandidates() {
  const found: string[] = []
  for (const candidate of homeCandidates()) {
    if (await isDir(candidate)) found.push(candidate)
  }
  return found
}

async function layoutFrom(root: string): Promise<ComfyLayout | null> {
  const directNodes = path.join(root, "custom_nodes")
  const nestedRoot = path.join(root, "ComfyUI")
  const nestedNodes = path.join(nestedRoot, "custom_nodes")

  if (await isDir(directNodes)) {
    return {
      input: root,
      comfyRoot: root,
      customNodes: directNodes,
      models: path.join(root, "models"),
      extraYaml: path.join(root, "extra_model_paths.yaml"),
    }
  }
  if (await isDir(nestedNodes)) {
    return {
      input: root,
      comfyRoot: nestedRoot,
      customNodes: nestedNodes,
      models: path.join(nestedRoot, "models"),
      extraYaml: path.join(nestedRoot, "extra_model_paths.yaml"),
    }
  }
  return null
}

export async function validateComfyRoot(input: string): Promise<ComfyRootCheck> {
  const candidates = await listComfyCandidates()
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, input: trimmed, error: "还没有填写 ComfyUI 根目录。", candidates }
  }
  if (looksLikeAppBundle(trimmed)) {
    return {
      ok: false,
      input: trimmed,
      error:
        "这是 macOS 应用程序包（.app），不是 ComfyUI 数据目录。请选安装目录或 Application Support 里的 ComfyUI 文件夹。",
      candidates,
    }
  }

  let resolved: string
  try {
    resolved = path.resolve(trimmed)
  } catch {
    return { ok: false, input: trimmed, error: "路径无效。", candidates }
  }

  if (!(await isDir(resolved))) {
    return {
      ok: false,
      input: trimmed,
      error: "这个路径不存在，或者不是文件夹。",
      candidates,
    }
  }

  const layout = await layoutFrom(resolved)
  if (!layout) {
    return {
      ok: false,
      input: trimmed,
      error: "这里没有 custom_nodes。请选 ComfyUI 根目录（里面应有 custom_nodes，便携版也可能在 ComfyUI/ 子目录）。",
      candidates,
    }
  }

  const hasMain = await isFile(path.join(layout.comfyRoot, "main.py"))
  const hasModels = await isDir(layout.models)
  if (!hasMain && !hasModels) {
    return {
      ok: false,
      input: trimmed,
      error: "没有看到 main.py，也没有 models 目录，不像是 ComfyUI。",
      candidates,
    }
  }

  if (!(await writable(layout.customNodes))) {
    return {
      ok: false,
      input: trimmed,
      layout,
      error: `Studio 不能写入 ${layout.customNodes}。请检查文件夹权限。`,
      candidates,
    }
  }

  return { ok: true, input: trimmed, layout, candidates }
}

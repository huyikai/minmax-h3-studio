import fs from "node:fs/promises"
import path from "node:path"
import type { ComfyLayout } from "@/lib/comfy-root"
import { rootDir } from "@/lib/paths"

export const MOTION_CONTEXT_FOLDER = "ComfyUI-H3-Motion-Context"

export function vendorMotionContextDir() {
  return path.join(rootDir(), "vendor", MOTION_CONTEXT_FOLDER)
}

export function installedMotionContextDir(layout: ComfyLayout) {
  return path.join(layout.customNodes, MOTION_CONTEXT_FOLDER)
}

export async function motionContextOnDisk(layout?: ComfyLayout) {
  if (!layout) return false
  try {
    await fs.access(path.join(installedMotionContextDir(layout), "__init__.py"))
    return true
  } catch {
    return false
  }
}

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(from, to)
    } else {
      await fs.copyFile(from, to)
    }
  }
}

export async function installMotionContext(layout: ComfyLayout) {
  const src = vendorMotionContextDir()
  const dest = installedMotionContextDir(layout)
  try {
    await fs.access(path.join(src, "__init__.py"))
  } catch {
    throw new Error("Studio 仓库里缺少内置的 Motion Context 源码（vendor/ComfyUI-H3-Motion-Context）。")
  }
  if (await motionContextOnDisk(layout)) {
    return { dest, copied: false }
  }
  await copyDir(src, dest)
  return { dest, copied: true }
}

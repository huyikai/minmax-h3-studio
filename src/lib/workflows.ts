import fs from "node:fs/promises"
import path from "node:path"
import { workflowsDir } from "@/lib/paths"

const JSON_EXT = ".json"

export function safeWorkflowName(name: string) {
  const base = path.basename(name).trim()
  if (!base || base !== path.posix.normalize(base) || base.includes("..")) {
    throw new Error("非法的工作流文件名")
  }
  if (!base.endsWith(JSON_EXT)) {
    return `${base}${JSON_EXT}`
  }
  return base
}

export async function ensureWorkflowsDir() {
  await fs.mkdir(workflowsDir(), { recursive: true })
}

export async function listWorkflowFiles() {
  await ensureWorkflowsDir()
  const entries = await fs.readdir(workflowsDir(), { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(JSON_EXT))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
}

export async function readWorkflowFile(name: string) {
  const filename = safeWorkflowName(name)
  const fullPath = path.join(workflowsDir(), filename)
  const raw = await fs.readFile(fullPath, "utf8")
  return { filename, data: JSON.parse(raw) as unknown }
}

export async function writeWorkflowFile(name: string, data: unknown) {
  await ensureWorkflowsDir()
  const filename = safeWorkflowName(name)
  const fullPath = path.join(workflowsDir(), filename)
  await fs.writeFile(fullPath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
  return filename
}

export async function deleteWorkflowFile(name: string) {
  const filename = safeWorkflowName(name)
  await fs.unlink(path.join(workflowsDir(), filename))
  return filename
}

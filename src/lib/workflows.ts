import fs from "node:fs/promises"
import path from "node:path"
import {
  BUNDLED_WORKFLOWS,
  isBundledWorkflow,
  type WorkflowListItem,
} from "@/lib/default-workflows"
import { bundledWorkflowsDir, workflowsDir } from "@/lib/paths"
import { WORKFLOW_ALIASES } from "@/lib/refs"

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

async function listJsonNames(dir: string) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(JSON_EXT))
      .map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function userWorkflowExists(filename: string) {
  try {
    await fs.access(path.join(workflowsDir(), filename))
    return true
  } catch {
    return false
  }
}

export async function listWorkflowEntries(): Promise<WorkflowListItem[]> {
  await ensureWorkflowsDir()
  const userFiles = await listJsonNames(workflowsDir())
  const bundledFiles = await listJsonNames(bundledWorkflowsDir())
  const bundledSet = new Set(
    BUNDLED_WORKFLOWS.map((item) => item.file).filter((file) =>
      bundledFiles.includes(file)
    )
  )
  const userSet = new Set(userFiles)

  const items: WorkflowListItem[] = BUNDLED_WORKFLOWS.filter((item) =>
    bundledSet.has(item.file)
  ).map((item) => ({
    name: item.file,
    label: item.label,
    description: item.description,
    family: item.family,
    bundled: true,
    overridden: userSet.has(item.file),
  }))

  for (const name of userFiles.sort((a, b) => a.localeCompare(b, "zh-CN"))) {
    if (bundledSet.has(name)) continue
    items.push({
      name,
      label: name,
      description: "你导入的 API 工作流",
      family: "custom",
      bundled: false,
      overridden: false,
    })
  }

  return items
}

export async function listWorkflowFiles() {
  const entries = await listWorkflowEntries()
  return entries.map((item) => item.name)
}

async function readJsonFile(fullPath: string) {
  const raw = await fs.readFile(fullPath, "utf8")
  return JSON.parse(raw) as unknown
}

export async function readWorkflowFile(name: string) {
  const filename = safeWorkflowName(name)
  const userPath = path.join(workflowsDir(), filename)
  if (await userWorkflowExists(filename)) {
    return { filename, data: await readJsonFile(userPath), source: "user" as const }
  }
  const aliased = WORKFLOW_ALIASES[filename]
  if (aliased && aliased !== filename) {
    return readWorkflowFile(aliased)
  }
  if (isBundledWorkflow(filename)) {
    const bundledPath = path.join(bundledWorkflowsDir(), filename)
    return {
      filename,
      data: await readJsonFile(bundledPath),
      source: "bundled" as const,
    }
  }
  throw new Error("找不到这份工作流")
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
  const userPath = path.join(workflowsDir(), filename)
  if (await userWorkflowExists(filename)) {
    await fs.unlink(userPath)
    return {
      filename,
      restored: isBundledWorkflow(filename),
    }
  }
  if (isBundledWorkflow(filename)) {
    throw new Error("官方预设不能删除。上传同名 JSON 可以覆盖，删掉覆盖后会回到预设。")
  }
  throw new Error("找不到这份工作流")
}

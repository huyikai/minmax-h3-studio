import type { EnvironmentLine } from "@/lib/environment-types"

export type WorkflowFamily = "official" | "turbo" | "reference" | "long" | "custom"

export type BundledWorkflow = {
  file: string
  label: string
  description: string
  family: Exclude<WorkflowFamily, "custom">
  picker?: boolean
}

export type WorkflowListItem = {
  name: string
  label: string
  description: string
  family: WorkflowFamily
  bundled: boolean
  overridden: boolean
  picker?: boolean
}

export const BUNDLED_WORKFLOWS: BundledWorkflow[] = [
  {
    file: "h3-t2v.json",
    label: "官方 · 文生",
    description: "20 步，质量优先。不放参考图。",
    family: "official",
  },
  {
    file: "h3-i2v.json",
    label: "官方 · 图生",
    description: "20 步。用首帧当第一帧。",
    family: "official",
  },
  {
    file: "h3-flf.json",
    label: "官方 · 首尾帧",
    description: "20 步。首帧起点，尾帧终点。",
    family: "official",
  },
  {
    file: "h3-t2v-turbo.json",
    label: "Turbo · 文生",
    description: "6 步 + Turbo LoRA。更快，需要加速 LoRA 和自定义节点。",
    family: "turbo",
  },
  {
    file: "h3-i2v-turbo.json",
    label: "Turbo · 图生",
    description: "6 步 + Turbo LoRA。用首帧当第一帧。",
    family: "turbo",
  },
  {
    file: "h3-r2v.json",
    label: "官方 · 参考生",
    description: "Ref2VA。按需要加参考图、视频、音频，最多 9 / 3 / 3。",
    family: "reference",
  },
  {
    file: "h3-t2v-long.json",
    label: "长视频 · 文生链",
    description:
      "官方文生 20 步，接上 Motion Context / Load / Save Latent / Trim。新建长视频用这份图。需要 ComfyUI-H3-Motion-Context。",
    family: "long",
    picker: false,
  },
]

export function bundledWorkflow(name: string) {
  return BUNDLED_WORKFLOWS.find((item) => item.file === name)
}

export function isBundledWorkflow(name: string) {
  return Boolean(bundledWorkflow(name))
}

export function workflowLabel(name: string) {
  return bundledWorkflow(name)?.label ?? name
}

export function workflowEnvironmentLine(name: string): EnvironmentLine {
  const family = bundledWorkflow(name)?.family
  if (family === "turbo") return "turbo"
  if (family === "reference") return "reference"
  if (family === "long") return "long"
  return "short"
}

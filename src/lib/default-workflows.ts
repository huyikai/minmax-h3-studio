export type WorkflowFamily = "official" | "turbo" | "reference" | "custom"

export type BundledWorkflow = {
  file: string
  label: string
  description: string
  family: Exclude<WorkflowFamily, "custom">
}

export type WorkflowListItem = {
  name: string
  label: string
  description: string
  family: WorkflowFamily
  bundled: boolean
  overridden: boolean
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
    label: "参考生 · 图",
    description: "Ref2VA。两张参考图，提示词里用 <Picture 1> / <Picture 2>。",
    family: "reference",
  },
  {
    file: "h3-r2v-video.json",
    label: "参考生 · 视频",
    description: "Ref2VA。一张参考图 + 一段参考视频，用 <Picture 1> / <Video 1>。",
    family: "reference",
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

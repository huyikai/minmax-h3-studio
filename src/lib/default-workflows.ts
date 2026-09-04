import type { EnvironmentLine } from "@/lib/environment-types"
import type { LongVideoWorkflowKind, MediaKind } from "@/lib/types"

export type LongWorkflowCapabilities = {
  kind: LongVideoWorkflowKind
  motionContext: boolean
  publicReferenceKinds: MediaKind[]
  segmentReferenceKinds: MediaKind[]
  supportsFirstFrame: boolean
  supportsLastFrame: boolean
  supportsMotionContextWithLastFrame: boolean
  supportsAudio: boolean
  supportsVideoReference: boolean
  supportsImageReference: boolean
  validated: boolean
  unavailableReason?: string
}

export const LONG_T2V_FILE = "h3-t2v-long.json"
export const LONG_I2V_FILE = "h3-i2v-long.json"
export const LONG_R2V_FILE = "h3-r2v-long.json"
export const LONG_FLF_FILE = "h3-flf-long.json"

export const LONG_WORKFLOW_CAPABILITIES: Record<string, LongWorkflowCapabilities> = {
  [LONG_T2V_FILE]: {
    kind: "t2v",
    motionContext: true,
    publicReferenceKinds: [],
    segmentReferenceKinds: [],
    supportsFirstFrame: false,
    supportsLastFrame: false,
    supportsMotionContextWithLastFrame: false,
    supportsAudio: false,
    supportsVideoReference: false,
    supportsImageReference: false,
    validated: true,
  },
  [LONG_I2V_FILE]: {
    kind: "i2v",
    motionContext: true,
    publicReferenceKinds: [],
    segmentReferenceKinds: [],
    supportsFirstFrame: true,
    supportsLastFrame: false,
    supportsMotionContextWithLastFrame: false,
    supportsAudio: false,
    supportsVideoReference: false,
    supportsImageReference: false,
    validated: true,
  },
  [LONG_R2V_FILE]: {
    kind: "r2v",
    motionContext: true,
    publicReferenceKinds: ["image", "video", "audio"],
    segmentReferenceKinds: ["image", "video", "audio"],
    supportsFirstFrame: false,
    supportsLastFrame: false,
    supportsMotionContextWithLastFrame: false,
    supportsAudio: true,
    supportsVideoReference: true,
    supportsImageReference: true,
    validated: true,
  },
  [LONG_FLF_FILE]: {
    kind: "f2v",
    motionContext: true,
    publicReferenceKinds: [],
    segmentReferenceKinds: [],
    supportsFirstFrame: true,
    supportsLastFrame: true,
    supportsMotionContextWithLastFrame: true,
    supportsAudio: false,
    supportsVideoReference: false,
    supportsImageReference: false,
    validated: true,
  },
}

export function longWorkflowCapabilities(name: string) {
  return LONG_WORKFLOW_CAPABILITIES[name]
}

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
  longCapabilities?: LongWorkflowCapabilities
}

export const LONG_WORKFLOW_GROUPS: Array<{
  kind: LongVideoWorkflowKind
  label: string
}> = [
  { kind: "t2v", label: "文生长视频" },
  { kind: "i2v", label: "图生长视频" },
  { kind: "r2v", label: "参考生长视频" },
  { kind: "f2v", label: "首尾帧长视频" },
]

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
    file: LONG_T2V_FILE,
    label: "长视频 · 文生链",
    description:
      "官方文生 20 步，接上 Motion Context / Load / Save Latent / Trim。新建长视频用这份图。需要 ComfyUI-H3-Motion-Context。",
    family: "long",
    picker: false,
  },
  {
    file: LONG_I2V_FILE,
    label: "长视频 · 图生链",
    description: "官方图生接上 Motion Context。第 1 段用首帧，后续段用上一镜潜变量衔接。",
    family: "long",
    picker: false,
  },
  {
    file: LONG_R2V_FILE,
    label: "长视频 · 参考生链",
    description: "官方参考生接上 Motion Context。公共参考锁定后每段自动注入，本段还可另加参考。",
    family: "long",
    picker: false,
  },
  {
    file: LONG_FLF_FILE,
    label: "长视频 · 首尾帧链",
    description: "官方首尾帧接上 Motion Context。第 1 段用首帧，每段可选尾帧。",
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

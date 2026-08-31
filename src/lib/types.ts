export type ComfyNode = {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}

export type ApiWorkflow = Record<string, ComfyNode>

export type FieldMapping = {
  nodeId: string
  input: string
}

export type LoraMapping = {
  nodeId: string
  nameInput: string
  strengthInput: string
  nested?: boolean
}

export type WorkflowMapping = {
  prompt?: FieldMapping
  firstFrame?: FieldMapping
  duration?: FieldMapping
  durationUnit?: "seconds" | "frames"
  width?: FieldMapping
  height?: FieldMapping
  seed?: FieldMapping
  steps?: FieldMapping
  cfg?: FieldMapping
  loras: LoraMapping[]
}

export type MappingOverrides = {
  prompt?: FieldMapping | null
  firstFrame?: FieldMapping | null
  duration?: FieldMapping | null
  durationUnit?: "seconds" | "frames" | null
  width?: FieldMapping | null
  height?: FieldMapping | null
  seed?: FieldMapping | null
  steps?: FieldMapping | null
  cfg?: FieldMapping | null
  loras?: LoraMapping[] | null
}

export type Settings = {
  comfyHost: string
  comfyPort: number
  defaultWorkflow: string | null
  mappings: Record<string, MappingOverrides>
}

export type LoraFormValue = {
  nodeId: string
  name: string
  strength: number
  enabled: boolean
  nested: boolean
  nameInput: string
  strengthInput: string
}

export type JobStatus =
  | "queued"
  | "running"
  | "success"
  | "error"
  | "interrupted"

export type JobProgress = {
  value: number
  max: number
  node?: string
  nodeTitle?: string
}

export type Job = {
  id: string
  createdAt: string
  updatedAt: string
  status: JobStatus
  workflowFile: string
  prompt: string
  duration: number
  aspect: string
  width: number
  height: number
  seed: number
  firstFrameName?: string
  loras: LoraFormValue[]
  steps?: number
  cfg?: number
  comfyPromptId?: string
  clientId: string
  progress?: JobProgress
  error?: string
  outputFile?: string
  submittedWorkflowFile?: string
}

export type PublicJob = Job & {
  outputUrl?: string
  workflowUrl: string
}

export type HealthStatus = {
  ok: boolean
  host: string
  port: number
  queueRemaining: number
  error?: string
}

export const ASPECT_PRESETS = [
  { id: "16:9", label: "16:9", width: 1344, height: 768 },
  { id: "9:16", label: "9:16", width: 768, height: 1344 },
  { id: "1:1", label: "1:1", width: 768, height: 768 },
  { id: "4:3", label: "4:3", width: 1024, height: 768 },
  { id: "3:4", label: "3:4", width: 768, height: 1024 },
] as const

export const DURATION_OPTIONS = [5, 6, 8, 10, 12, 15] as const

export const DEFAULT_SETTINGS: Settings = {
  comfyHost: "127.0.0.1",
  comfyPort: 8188,
  defaultWorkflow: null,
  mappings: {},
}

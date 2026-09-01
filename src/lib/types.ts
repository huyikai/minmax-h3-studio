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

export type MediaKind = "image" | "video" | "audio"

export type MediaRole =
  | "firstFrame"
  | "lastFrame"
  | "refImage"
  | "refVideo"
  | "refAudio"

export type MediaSlot = {
  id: string
  kind: MediaKind
  role: MediaRole
  label: string
  help: string
  nodeId: string
  input: string
  h3NodeId: string
  h3Input: string
  bridgeNodeId?: string
}

export type WorkflowMapping = {
  prompt?: FieldMapping
  firstFrame?: FieldMapping
  lastFrame?: FieldMapping
  duration?: FieldMapping
  durationUnit?: "seconds" | "frames"
  width?: FieldMapping
  height?: FieldMapping
  seed?: FieldMapping
  steps?: FieldMapping
  cfg?: FieldMapping
  loras: LoraMapping[]
  media: MediaSlot[]
  dynamicRefs?: boolean
  h3NodeId?: string
}

export type MappingOverrides = {
  prompt?: FieldMapping | null
  firstFrame?: FieldMapping | null
  lastFrame?: FieldMapping | null
  duration?: FieldMapping | null
  durationUnit?: "seconds" | "frames" | null
  width?: FieldMapping | null
  height?: FieldMapping | null
  seed?: FieldMapping | null
  steps?: FieldMapping | null
  cfg?: FieldMapping | null
  loras?: LoraMapping[] | null
}

export type H3UnetPrecision = "int8" | "fp8" | "bf16"

export type Settings = {
  comfyHost: string
  comfyPort: number
  defaultWorkflow: string | null
  mappings: Record<string, MappingOverrides>
  comfyRoot: string
  extraModelsDir: string
  h3UnetPrecision: H3UnetPrecision
  hfToken: string
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
  | "waiting"
  | "queued"
  | "running"
  | "awaiting"
  | "success"
  | "error"
  | "interrupted"

export type JobKind = "short" | "long"

export type LongSegmentStatus =
  | "waiting"
  | "queued"
  | "running"
  | "success"
  | "error"
  | "interrupted"
  | "voided"

export type LongSegment = {
  index: number
  prompt: string
  submittedPrompt: string
  duration: number
  seed: number
  status: LongSegmentStatus
  enqueuedAt?: string
  comfyPromptId?: string
  outputFile?: string
  outputUrl?: string
  error?: string
}

export type StoredInputMedia = {
  slotId: string
  file: string
  originalName: string
  contentType: string
  kind?: MediaKind
  index?: number
}

export type StudioQueueItem = {
  jobId: string
  kind: JobKind
  state: "running" | "waiting"
  label: string
  prompt: string
  enqueuedAt: string
  segmentIndex?: number
}

export type StudioQueueSnapshot = {
  paused: boolean
  remaining: number
  items: StudioQueueItem[]
}

export type LongVideoState = {
  lockPrompt: string
  finalized: boolean
  aspectLocked: boolean
  segments: LongSegment[]
  stitchedFile?: string
  stitchError?: string
}

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
  kind?: JobKind
  workflowFile: string
  prompt: string
  duration: number
  aspect: string
  width: number
  height: number
  seed: number
  firstFrameName?: string
  lastFrameName?: string
  mediaNames?: string[]
  loras: LoraFormValue[]
  steps?: number
  cfg?: number
  comfyPromptId?: string
  clientId: string
  progress?: JobProgress
  error?: string
  outputFile?: string
  submittedWorkflowFile?: string
  enqueuedAt?: string
  inputMedia?: StoredInputMedia[]
  long?: LongVideoState
}

export type PublicJob = Omit<Job, "inputMedia"> & {
  kind: JobKind
  outputUrl?: string
  previewUrl?: string
  stitchedUrl?: string
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

export const DURATION_OPTIONS = [5, 6, 7, 8, 10, 12, 15] as const

export const DEFAULT_SETTINGS: Settings = {
  comfyHost: "127.0.0.1",
  comfyPort: 8188,
  defaultWorkflow: null,
  mappings: {},
  comfyRoot: "",
  extraModelsDir: "",
  h3UnetPrecision: "int8",
  hfToken: "",
}

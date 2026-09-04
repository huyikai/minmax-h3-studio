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

export type LoraKind = "turbo" | "generic"

export type LoraMapping = {
  nodeId: string
  nameInput: string
  strengthInput: string
  nested?: boolean
  kind?: LoraKind
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
  kind?: LoraKind
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
  startedAt?: string
  runElapsedMs?: number
  comfyPromptId?: string
  outputFile?: string
  outputUrl?: string
  error?: string
  segmentRefs?: StoredInputMedia[]
  firstFrame?: StoredInputMedia
  lastFrame?: StoredInputMedia
}

export type MediaScope = "public" | "segment"

export type StoredInputMedia = {
  slotId: string
  file: string
  originalName: string
  contentType: string
  kind?: MediaKind
  index?: number
  scope?: MediaScope
  segmentIndex?: number
  role?: MediaRole
}

export type StudioQueueItem = {
  jobId: string
  kind: JobKind
  state: "running" | "waiting"
  label: string
  prompt: string
  enqueuedAt: string
  segmentIndex?: number
  blocked?: boolean
}

export type StudioQueueSnapshot = {
  paused: boolean
  remaining: number
  items: StudioQueueItem[]
}

export type LongVideoWorkflowKind = "t2v" | "i2v" | "r2v" | "f2v"

export type LongVideoState = {
  workflowFile?: string
  workflowKind?: LongVideoWorkflowKind
  lockPrompt: string
  publicLockRefs?: StoredInputMedia[]
  lockFrozen?: boolean
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
  megapixels?: number
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
  startedAt?: string
  runElapsedMs?: number
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
  { id: "16:9", label: "16:9", ratioWidth: 16, ratioHeight: 9 },
  { id: "9:16", label: "9:16", ratioWidth: 9, ratioHeight: 16 },
  { id: "1:1", label: "1:1", ratioWidth: 1, ratioHeight: 1 },
  { id: "4:3", label: "4:3", ratioWidth: 4, ratioHeight: 3 },
  { id: "3:4", label: "3:4", ratioWidth: 3, ratioHeight: 4 },
] as const

export const RESOLUTION_PRESETS = [
  0.4,
  0.5,
  0.6,
  0.7,
  0.8,
  0.9,
  0.98,
  1.2,
  1.5,
  2.0,
] as const

export type ResolutionPreset = (typeof RESOLUTION_PRESETS)[number]

export const DURATION_OPTIONS = [5, 6, 7, 8, 10, 12, 15] as const

export const LONG_STEP_OPTIONS = [16, 20, 25] as const

export type LongStepOption = (typeof LONG_STEP_OPTIONS)[number]

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

import type {
  ApiWorkflow,
  Job,
  LongSegment,
  LongVideoState,
  MediaKind,
} from "@/lib/types"
import {
  LONG_T2V_FILE,
  longWorkflowCapabilities,
} from "@/lib/default-workflows"

export { LONG_T2V_FILE }

export const MOTION_CONTEXT_INSTALL_URL =
  "https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context"

export const MOTION_CONTEXT_COMFY_MIN = "0.34.0"

export const MOTION_CONTEXT_NODE_CLASSES = [
  "MiniMaxH3MotionContext",
  "MiniMaxH3MotionContextTrim",
  "MiniMaxH3MotionContextSaveLatent",
  "MiniMaxH3MotionContextLoadLatent",
] as const

export const MOTION_CONTEXT_FRAMES = 22
export const MOTION_CONTEXT_FPS = 24
export const MOTION_CONTEXT_AUDIO_HZ = 32_000

const LOCK_FIELD = "integrated_multimodal_description:"

export const LATENT_MISSING_MESSAGE =
  "上一镜的 Motion Context 潜变量找不到。定稿后如果清理过 ComfyUI 的 output/h3_studio 目录，不能从第 1 段静默重来。请重做能接到的那一段，或另开一条长视频。"

export function longWorkflowCapabilitiesForJob(
  job: Pick<Job, "workflowFile" | "long">
) {
  return (
    (job.long?.workflowFile
      ? longWorkflowCapabilities(job.long.workflowFile)
      : undefined) ??
    longWorkflowCapabilities(job.workflowFile) ??
    longWorkflowCapabilities(LONG_T2V_FILE)
  )
}

export type LongWorkflowInputFlags = {
  hasReferences?: boolean
  referenceKinds?: MediaKind[]
  hasFirstFrame?: boolean
  hasLastFrame?: boolean
  hasAudio?: boolean
  hasVideoReference?: boolean
  hasImageReference?: boolean
}

export function longWorkflowInputFlags(input: {
  publicRefs?: Array<{ kind?: MediaKind }>
  segmentRefs?: Array<{ kind?: MediaKind }>
  firstFrame?: unknown
  lastFrame?: unknown
}): LongWorkflowInputFlags {
  const refs = [...(input.publicRefs ?? []), ...(input.segmentRefs ?? [])]
  const kinds = refs
    .map((item) => item.kind)
    .filter((kind): kind is MediaKind => kind === "image" || kind === "video" || kind === "audio")
  return {
    hasReferences: kinds.length > 0,
    referenceKinds: kinds,
    hasFirstFrame: Boolean(input.firstFrame),
    hasLastFrame: Boolean(input.lastFrame),
    hasAudio: kinds.includes("audio"),
    hasVideoReference: kinds.includes("video"),
    hasImageReference: kinds.includes("image"),
  }
}

export function longWorkflowDisableReason(
  workflowFile: string,
  input: LongWorkflowInputFlags = {}
) {
  const capabilities = longWorkflowCapabilities(workflowFile)
  if (!capabilities) return "缺少长视频能力声明"
  if (!capabilities.motionContext) return "缺少 Motion Context"
  if (!capabilities.validated) {
    return capabilities.unavailableReason ?? "尚未真实验证两段连续生成"
  }
  return longWorkflowIncompatibility(workflowFile, input)
}

export function longWorkflowIncompatibility(
  workflowFile: string,
  input: LongWorkflowInputFlags = {}
) {
  const capabilities = longWorkflowCapabilities(workflowFile)
  if (!capabilities) return "缺少长视频能力声明"
  if (!capabilities.motionContext) return "缺少 Motion Context"
  const kinds = new Set(input.referenceKinds ?? [])
  const hasImage = input.hasImageReference || kinds.has("image")
  const hasVideo = input.hasVideoReference || kinds.has("video")
  const hasAudio = input.hasAudio || kinds.has("audio")
  const hasReferences = input.hasReferences || hasImage || hasVideo || hasAudio

  if (hasReferences && capabilities.publicReferenceKinds.length === 0) {
    if (hasImage) return "当前任务包含公共参考图片，不支持文生"
    if (hasVideo) return "当前任务包含公共参考视频，不支持文生"
    if (hasAudio) return "当前任务包含公共参考音频，不支持文生"
    return "当前任务包含参考元素，不支持文生长视频"
  }
  if (hasImage && !capabilities.supportsImageReference) {
    return "当前任务包含公共参考图片，不支持文生"
  }
  if (hasVideo && !capabilities.supportsVideoReference) {
    return "有视频参考时，只支持能接参考视频的长视频工作流"
  }
  if (hasAudio && !capabilities.supportsAudio) {
    return "有音频时，只支持能接参考音频的长视频工作流"
  }
  if (input.hasFirstFrame && !capabilities.supportsFirstFrame) {
    return "有首帧时，只支持图生或首尾帧长视频"
  }
  if (input.hasLastFrame) {
    if (!capabilities.supportsLastFrame) return "不支持当前段尾帧"
    if (!capabilities.supportsMotionContextWithLastFrame) {
      return "Motion Context 不能与尾帧同时接入"
    }
  }
  return undefined
}

export function canChangeLongWorkflow(job: Pick<Job, "kind" | "long">) {
  if (!isLongJob(job) || !job.long) return false
  return job.long.segments.length === 0
}

export function isLongLockFrozen(state: LongVideoState | undefined) {
  if (!state) return false
  if (state.lockFrozen !== undefined) return state.lockFrozen
  return liveSegments(state).length > 0
}

export function canChangeLockPrompt(job: Pick<Job, "kind" | "long">) {
  if (!isLongJob(job) || !job.long) return false
  return !isLongLockFrozen(job.long)
}

export function normalizeLongState(
  job: Pick<Job, "workflowFile" | "long" | "kind">
): LongVideoState {
  const current = job.long
  const workflowFile =
    current?.workflowFile || job.workflowFile || LONG_T2V_FILE
  const capabilities = longWorkflowCapabilities(workflowFile)
  return {
    workflowFile,
    workflowKind: current?.workflowKind ?? capabilities?.kind ?? "t2v",
    lockPrompt: current?.lockPrompt ?? "",
    publicLockRefs: current?.publicLockRefs ?? [],
    lockFrozen: current?.lockFrozen ?? liveSegments(current).length > 0,
    finalized: Boolean(current?.finalized),
    aspectLocked: Boolean(current?.aspectLocked),
    segments: (current?.segments ?? []).map(normalizeLongSegment),
    stitchedFile: current?.stitchedFile,
    stitchError: current?.stitchError,
  }
}

export function normalizeLongSegment(segment: LongSegment): LongSegment {
  return {
    ...segment,
    segmentRefs: segment.segmentRefs ?? [],
  }
}

export function normalizeJob<T extends Job>(job: T): T {
  if (job.kind !== "long" && !job.long) {
    return { ...job, kind: job.kind ?? "short" }
  }
  const long = normalizeLongState(job)
  return {
    ...job,
    kind: "long",
    workflowFile: long.workflowFile || job.workflowFile || LONG_T2V_FILE,
    long,
  }
}


export function isLongJob(job: Pick<Job, "kind">) {
  return job.kind === "long"
}

export function emptyLongState(
  lockPrompt = "",
  workflowFile = LONG_T2V_FILE
): LongVideoState {
  const capabilities = longWorkflowCapabilities(workflowFile)
  return {
    workflowFile,
    workflowKind: capabilities?.kind ?? "t2v",
    lockPrompt,
    publicLockRefs: [],
    lockFrozen: true,
    finalized: false,
    aspectLocked: false,
    segments: [],
  }
}

export function mergeLockIntoPrompt(lock: string, prompt: string) {
  const lockText = lock.trim()
  if (!lockText) return prompt
  const idx = prompt.toLowerCase().indexOf(LOCK_FIELD)
  if (idx < 0) {
    return `${lockText}\n\n${prompt}`.trim()
  }
  const bodyStart = idx + LOCK_FIELD.length
  return `${prompt.slice(0, bodyStart)} ${lockText}${prompt.slice(bodyStart)}`
}

export function segmentFileName(index: number) {
  return `seg_${String(index).padStart(3, "0")}.mp4`
}

export function stitchedFileName() {
  return "stitched.mp4"
}

export function latentFolder(jobId: string) {
  return `h3_studio/${jobId}`
}

export function successfulSegments(state: LongVideoState | undefined) {
  return (state?.segments ?? []).filter((item) => item.status === "success")
}

export function lastSuccessfulSegment(state: LongVideoState | undefined) {
  const items = successfulSegments(state)
  return items[items.length - 1]
}

export function liveSegments(state: LongVideoState | undefined) {
  return (state?.segments ?? [])
    .filter((item) => item.status !== "voided")
    .slice()
    .sort((a, b) => a.index - b.index)
}

export function waitingSegments(state: LongVideoState | undefined) {
  return liveSegments(state).filter((item) => item.status === "waiting")
}

export function waitingSegment(state: LongVideoState | undefined) {
  return waitingSegments(state)[0]
}

export function lastWaitingSegment(state: LongVideoState | undefined) {
  const items = waitingSegments(state)
  return items[items.length - 1]
}

export function queuedLongSegments(state: LongVideoState | undefined) {
  return liveSegments(state).filter(
    (item) => item.status === "waiting" || item.status === "queued"
  )
}

export function runningLongSegment(state: LongVideoState | undefined) {
  return liveSegments(state).find((item) => item.status === "running")
}

export function expectedLongSegmentIndex(state: LongVideoState | undefined) {
  return liveSegments(state).reduce((highest, item) => Math.max(highest, item.index), 0)
}

export function impactedLongSegments(state: LongVideoState | undefined) {
  const broken = chainBreakSegment(state)
  return broken ? laterSegments(state, broken.index) : []
}

export function laterSegments(state: LongVideoState | undefined, index: number) {
  return liveSegments(state).filter((item) => item.index > index)
}

export function chainBreakSegment(state: LongVideoState | undefined) {
  return liveSegments(state).find(
    (item) => item.status === "error" || item.status === "interrupted"
  )
}

export function activeLongSegment(state: LongVideoState | undefined) {
  const items = state?.segments ?? []
  return (
    items.find((item) => item.status === "running") ??
    items.find((item) => item.status === "queued") ??
    items.find(
      (item) =>
        item.status === "waiting" && canDispatchLongSegment(state, item.index)
    ) ??
    items.find((item) => item.status === "waiting")
  )
}

export function retryableSegment(state: LongVideoState | undefined) {
  return chainBreakSegment(state)
}

export function canDispatchLongSegment(
  state: LongVideoState | undefined,
  index: number
) {
  if (index <= 1) return true
  const previous = (state?.segments ?? []).find((item) => item.index === index - 1)
  return previous?.status === "success"
}

export function hasUnfinishedSegments(state: LongVideoState | undefined) {
  return liveSegments(state).some(
    (item) =>
      item.status === "waiting" ||
      item.status === "queued" ||
      item.status === "running"
  )
}

export function nextClipIndex(state: LongVideoState | undefined) {
  const broken = chainBreakSegment(state)
  if (broken) return broken.index
  const occupied = liveSegments(state).filter(
    (item) =>
      item.status === "success" ||
      item.status === "running" ||
      item.status === "queued" ||
      item.status === "waiting"
  )
  if (occupied.length === 0) return 1
  return Math.max(...occupied.map((item) => item.index)) + 1
}

export function segmentDeliveredSeconds(duration: number, index: number) {
  if (index <= 1) return duration
  return Math.max(0, duration - MOTION_CONTEXT_FRAMES / MOTION_CONTEXT_FPS)
}

export function chainDeliveredSeconds(state: LongVideoState | undefined) {
  return successfulSegments(state).reduce(
    (sum, item) => sum + segmentDeliveredSeconds(item.duration, item.index),
    0
  )
}

export function formatApproxSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s"
  const rounded = Math.round(seconds)
  return `约 ${rounded}s`
}

export function voidSegmentsAfter(
  segments: LongSegment[],
  index: number
): LongSegment[] {
  return segments.map((item) =>
    item.index > index ? { ...item, status: "voided" as const } : item
  )
}

function findClass(workflow: ApiWorkflow, classType: string) {
  return Object.entries(workflow).find(([, node]) => node.class_type === classType)
}

function findH3Node(workflow: ApiWorkflow) {
  return (
    findClass(workflow, "MiniMaxH3ImageToVideo") ??
    findClass(workflow, "MiniMaxH3ReferenceToVideo")
  )
}

export function patchLongChain(
  workflow: ApiWorkflow,
  options: { jobId: string; clipIndex: number; loadPrevious: boolean }
): ApiWorkflow {
  const next = structuredClone(workflow)
  const clipIndex = options.clipIndex
  if (!Number.isInteger(clipIndex) || clipIndex < 1) {
    throw new Error("clip_index 必须从 1 开始")
  }

  const save = findClass(next, "MiniMaxH3MotionContextSaveLatent")
  const load = findClass(next, "MiniMaxH3MotionContextLoadLatent")
  const motion = findClass(next, "MiniMaxH3MotionContext")
  const trim = findClass(next, "MiniMaxH3MotionContextTrim")
  const guider = findClass(next, "BasicGuider")

  if (!save) {
    throw new Error("长视频工作流缺少 H3 Motion Context Save Latent 节点")
  }

  const folder = latentFolder(options.jobId)
  save[1].inputs.filename_prefix = `${folder}/clip`
  save[1].inputs.clip_index = clipIndex

  if (!options.loadPrevious) {
    if (load) delete next[load[0]]
    if (motion) delete next[motion[0]]
    if (guider) {
      const h3 = findH3Node(next)
      if (h3) guider[1].inputs.conditioning = [h3[0], 0]
    }
    if (trim) trim[1].inputs.trim_frames = 0
    return next
  }

  if (!load || !motion) {
    throw new Error("长视频续写工作流缺少 Load / Motion Context 节点")
  }
  if (clipIndex < 2) {
    throw new Error("从第 2 段起才加载上一镜潜变量")
  }
  load[1].inputs.latent_path = folder
  load[1].inputs.clip_index = clipIndex - 1
  motion[1].inputs.context_latent = [load[0], 0]
  motion[1].inputs.context_length = "22"
  motion[1].inputs.audio_context_length = 24
  if (guider) guider[1].inputs.conditioning = [motion[0], 0]
  return next
}

export function rewriteLatentError(message: string) {
  if (/no saved latent|neither a file nor a folder|h3_motion_context: .*clip/i.test(message)) {
    return LATENT_MISSING_MESSAGE
  }
  return message
}

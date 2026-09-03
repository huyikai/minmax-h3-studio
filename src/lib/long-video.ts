import type { ApiWorkflow, Job, LongSegment, LongVideoState } from "@/lib/types"

export const LONG_T2V_FILE = "h3-t2v-long.json"

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

export function isLongJob(job: Pick<Job, "kind">) {
  return job.kind === "long"
}

export function emptyLongState(lockPrompt = ""): LongVideoState {
  return {
    lockPrompt,
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
      const h3 = findClass(next, "MiniMaxH3ImageToVideo")
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

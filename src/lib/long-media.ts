import type { LongWorkflowCapabilities } from "@/lib/default-workflows"
import { longWorkflowCapabilities } from "@/lib/default-workflows"
import {
  longWorkflowIncompatibility,
  longWorkflowInputFlags,
} from "@/lib/long-video"
import { REF_KINDS, REF_LIMITS, parseRefSlotId, refKindLabel, refSlotId } from "@/lib/refs"
import type {
  Job,
  LongSegment,
  MediaKind,
  StoredInputMedia,
} from "@/lib/types"
import type { MediaPatch } from "@/lib/workflow-core"

function kindOf(item: StoredInputMedia): MediaKind | undefined {
  if (item.kind) return item.kind
  return parseRefSlotId(item.slotId)?.kind
}

export function isRefMedia(item: StoredInputMedia) {
  if (item.role === "firstFrame" || item.role === "lastFrame") return false
  if (item.slotId === "firstFrame" || item.slotId === "lastFrame") return false
  return Boolean(kindOf(item) && parseRefSlotId(item.slotId))
}

export function mergeLongRefs(
  publicRefs: StoredInputMedia[] = [],
  segmentRefs: StoredInputMedia[] = []
): StoredInputMedia[] {
  const merged: StoredInputMedia[] = []
  for (const kind of REF_KINDS) {
    const publicItems = publicRefs
      .filter((item) => kindOf(item) === kind)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const segmentItems = segmentRefs
      .filter((item) => kindOf(item) === kind)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const combined = [...publicItems, ...segmentItems].slice(0, REF_LIMITS[kind])
    combined.forEach((item, index) => {
      merged.push({
        ...item,
        kind,
        index,
        slotId: refSlotId(kind, index),
      })
    })
  }
  return merged
}

export function publicLockRefs(job: Pick<Job, "long" | "inputMedia">) {
  if (job.long?.publicLockRefs?.length) return job.long.publicLockRefs
  return (job.inputMedia ?? []).filter(
    (item) => item.scope === "public" && isRefMedia(item)
  )
}

export function segmentMediaFor(
  job: Pick<Job, "long">,
  index: number
): {
  refs: StoredInputMedia[]
  firstFrame?: StoredInputMedia
  lastFrame?: StoredInputMedia
} {
  const segment = job.long?.segments.find((item) => item.index === index)
  return {
    refs: segment?.segmentRefs ?? [],
    firstFrame: segment?.firstFrame,
    lastFrame: segment?.lastFrame,
  }
}

export function storedMediaForSegment(
  job: Pick<Job, "long" | "inputMedia">,
  index: number
): StoredInputMedia[] {
  const publicRefs = publicLockRefs(job)
  const segment = segmentMediaFor(job, index)
  const merged = mergeLongRefs(publicRefs, segment.refs)
  const extra: StoredInputMedia[] = []
  if (segment.firstFrame) extra.push(segment.firstFrame)
  if (segment.lastFrame) extra.push(segment.lastFrame)
  return [...merged, ...extra]
}

export function mediaPatchesForSegment(
  uploaded: MediaPatch[],
  stored: StoredInputMedia[]
): MediaPatch[] {
  const byFile = new Map(uploaded.map((item) => [item.slotId, item]))
  return stored.map((item) => {
    const patch = byFile.get(item.slotId)
    return {
      slotId: item.slotId,
      filename: patch?.filename ?? item.file,
      kind: item.kind,
      index: item.index,
    }
  })
}

export function countRefsByKind(items: StoredInputMedia[]) {
  const counts: Record<MediaKind, number> = { image: 0, video: 0, audio: 0 }
  for (const item of items) {
    const kind = kindOf(item)
    if (kind) counts[kind] += 1
  }
  return counts
}

export function validateMergedRefCounts(items: StoredInputMedia[]) {
  const counts = countRefsByKind(items)
  for (const kind of REF_KINDS) {
    if (counts[kind] > REF_LIMITS[kind]) {
      return `${refKindLabel(kind)}最多 ${REF_LIMITS[kind]} 个（含公共锁定）`
    }
  }
  return undefined
}

export function validateLongCreateMedia(input: {
  workflowFile: string
  publicRefs: StoredInputMedia[]
  firstFrame?: StoredInputMedia
  lastFrame?: StoredInputMedia
}) {
  const capabilities = longWorkflowCapabilities(input.workflowFile)
  if (!capabilities?.motionContext) return "请选择包含 Motion Context 的长视频工作流"
  const flags = longWorkflowInputFlags({
    publicRefs: input.publicRefs,
    firstFrame: input.firstFrame,
    lastFrame: input.lastFrame,
  })
  const incompatible = longWorkflowIncompatibility(input.workflowFile, flags)
  if (incompatible) return incompatible
  const overflow = validateMergedRefCounts(input.publicRefs)
  if (overflow) return overflow
  for (const item of input.publicRefs) {
    const kind = kindOf(item)
    if (!kind) return "公共参考缺少类型"
    if (!capabilities.publicReferenceKinds.includes(kind)) {
      return `当前工作流不支持公共${refKindLabel(kind)}`
    }
  }
  if (input.firstFrame) return "公共锁定区不能上传首帧"
  if (input.lastFrame) return "公共锁定区不能上传尾帧"
  return undefined
}

export function validateLongSegmentMedia(input: {
  capabilities: LongWorkflowCapabilities
  clipIndex: number
  publicRefs: StoredInputMedia[]
  segmentRefs: StoredInputMedia[]
  firstFrame?: StoredInputMedia
  lastFrame?: StoredInputMedia
}) {
  const { capabilities, clipIndex } = input
  if (input.firstFrame && !capabilities.supportsFirstFrame) {
    return "当前工作流不支持首帧"
  }
  if (input.firstFrame && clipIndex > 1) {
    return "后续段首帧由 Motion Context 提供，不要再上传首帧"
  }
  if (!input.firstFrame && capabilities.supportsFirstFrame && clipIndex === 1) {
    return "第 1 段需要首帧"
  }
  if (input.lastFrame && !capabilities.supportsLastFrame) {
    return "当前工作流不支持尾帧"
  }
  if (
    input.lastFrame &&
    clipIndex > 1 &&
    !capabilities.supportsMotionContextWithLastFrame
  ) {
    return "Motion Context 不能与尾帧同时接入"
  }
  for (const item of input.segmentRefs) {
    const kind = kindOf(item)
    if (!kind) return "当前段参考缺少类型"
    if (!capabilities.segmentReferenceKinds.includes(kind)) {
      return `当前工作流不支持本段${refKindLabel(kind)}`
    }
  }
  const overflow = validateMergedRefCounts(
    mergeLongRefs(input.publicRefs, input.segmentRefs)
  )
  if (overflow) return overflow
  return undefined
}

export function firstFrameSlot(file?: StoredInputMedia): StoredInputMedia | undefined {
  if (!file) return undefined
  return {
    ...file,
    slotId: "firstFrame",
    role: "firstFrame",
    kind: "image",
  }
}

export function lastFrameSlot(file?: StoredInputMedia): StoredInputMedia | undefined {
  if (!file) return undefined
  return {
    ...file,
    slotId: "lastFrame",
    role: "lastFrame",
    kind: "image",
  }
}

export function withSegmentScope(
  items: StoredInputMedia[],
  segmentIndex: number
): StoredInputMedia[] {
  return items.map((item) => ({
    ...item,
    scope: "segment" as const,
    segmentIndex,
  }))
}

export function buildSegmentMediaRecord(
  clipIndex: number,
  media: {
    refs?: StoredInputMedia[]
    firstFrame?: StoredInputMedia
    lastFrame?: StoredInputMedia
  }
): Pick<LongSegment, "segmentRefs" | "firstFrame" | "lastFrame"> {
  return {
    segmentRefs: withSegmentScope(media.refs ?? [], clipIndex),
    firstFrame: media.firstFrame
      ? { ...firstFrameSlot(media.firstFrame)!, scope: "segment", segmentIndex: clipIndex }
      : undefined,
    lastFrame: media.lastFrame
      ? { ...lastFrameSlot(media.lastFrame)!, scope: "segment", segmentIndex: clipIndex }
      : undefined,
  }
}

export function inspectLongWorkflowGraph(
  workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
  clipIndex: number,
  jobId: string
) {
  const byClass = (classType: string) =>
    Object.entries(workflow).find(([, node]) => node.class_type === classType)
  const h3 =
    byClass("MiniMaxH3ImageToVideo") ?? byClass("MiniMaxH3ReferenceToVideo")
  const load = byClass("MiniMaxH3MotionContextLoadLatent")
  const motion = byClass("MiniMaxH3MotionContext")
  const save = byClass("MiniMaxH3MotionContextSaveLatent")
  const video = byClass("SaveVideo") ?? byClass("CreateVideo")
  const folder = `h3_studio/${jobId}`
  const issues: string[] = []
  if (!h3) issues.push("缺少 H3 条件节点")
  if (!save) issues.push("缺少 Save Latent")
  if (!video) issues.push("缺少视频输出节点")
  if (save && save[1].inputs.clip_index !== clipIndex) {
    issues.push(`Save Latent clip_index 应为 ${clipIndex}`)
  }
  if (clipIndex <= 1) {
    if (load) issues.push("第 1 段不应加载上一镜 Latent")
    if (motion) issues.push("第 1 段不应接入 Motion Context")
  } else {
    if (!load) issues.push("第 2 段缺少 Load Latent")
    else {
      if (load[1].inputs.clip_index !== clipIndex - 1) {
        issues.push(`Load Latent clip_index 应为 ${clipIndex - 1}`)
      }
      if (load[1].inputs.latent_path !== folder) {
        issues.push("Load Latent 路径应指向当前任务")
      }
    }
    if (!motion) issues.push("第 2 段缺少 Motion Context")
    else if (load) {
      const ctx = motion[1].inputs.context_latent
      if (!Array.isArray(ctx) || String(ctx[0]) !== load[0]) {
        issues.push("Motion Context 未使用 Load Latent 输出")
      }
    }
    if (save && save[1].inputs.clip_index !== clipIndex) {
      issues.push(`Save Latent clip_index 应为 ${clipIndex}`)
    }
  }
  return { ok: issues.length === 0, issues, h3Id: h3?.[0], loadId: load?.[0], motionId: motion?.[0], saveId: save?.[0] }
}

export function h3RefInputKeys(
  workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>
) {
  const h3 = Object.values(workflow).find(
    (node) =>
      node.class_type === "MiniMaxH3ImageToVideo" ||
      node.class_type === "MiniMaxH3ReferenceToVideo"
  )
  const keys = Object.keys(h3?.inputs ?? {})
  return {
    images: keys.filter((key) => key.startsWith("ref_images.")),
    videos: keys.filter((key) => key.startsWith("ref_videos.")),
    audios: keys.filter((key) => key.startsWith("ref_audios.")),
  }
}

export function firstFrameFilename(workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>) {
  const h3 = Object.values(workflow).find(
    (node) =>
      node.class_type === "MiniMaxH3ImageToVideo" ||
      node.class_type === "MiniMaxH3ReferenceToVideo"
  )
  const first = h3?.inputs.first_frame
  if (!Array.isArray(first) || typeof first[0] !== "string") return undefined
  const loader = workflow[first[0]]
  const image = loader?.inputs.image
  return typeof image === "string" ? image : undefined
}

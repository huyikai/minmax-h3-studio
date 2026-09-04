import fs from "node:fs/promises"
import path from "node:path"
import type { LongWorkflowCapabilities } from "@/lib/default-workflows"
import type { MediaKind, MediaRole, StoredInputMedia, WorkflowMapping } from "@/lib/types"
import { jobOutputDir } from "@/lib/paths"
import { REF_KINDS, REF_LIMITS, parseRefSlotId, refKindLabel, refSlotId } from "@/lib/refs"
import type { MediaPatch } from "@/lib/workflow-core"
import { uploadInputFile } from "@/lib/comfy"

function safeFileName(slotId: string, original: string) {
  const base = original.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file"
  const slot = slotId.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return `${slot}-${base}`
}

function kindFromContentType(contentType: string): MediaKind | undefined {
  if (contentType.startsWith("image/")) return "image"
  if (contentType.startsWith("video/")) return "video"
  if (contentType.startsWith("audio/")) return "audio"
  return undefined
}

function roleForSlot(slotId: string, kind?: MediaKind): MediaRole | undefined {
  if (slotId === "firstFrame") return "firstFrame"
  if (slotId === "lastFrame") return "lastFrame"
  if (kind === "image") return "refImage"
  if (kind === "video") return "refVideo"
  if (kind === "audio") return "refAudio"
  return undefined
}

export async function persistUploadedMedia(jobId: string, form: FormData, mapping: WorkflowMapping) {
  const uploads = new Map<string, File>()
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("media:")) continue
    if (!(value instanceof File) || value.size <= 0) continue
    uploads.set(key.slice("media:".length), value)
  }

  const dir = path.join(jobOutputDir(jobId), "inputs")
  await fs.mkdir(dir, { recursive: true })

  const inputMedia: StoredInputMedia[] = []
  const mediaNames: string[] = []
  let firstFrameName: string | undefined
  let lastFrameName: string | undefined

  async function saveOne(
    slotId: string,
    file: File,
    extra?: Partial<StoredInputMedia>
  ) {
    const filename = safeFileName(slotId, file.name || `${slotId}.bin`)
    const bytes = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(path.join(dir, filename), bytes)
    const kind = extra?.kind ?? kindFromContentType(file.type)
    inputMedia.push({
      slotId,
      file: filename,
      originalName: file.name || filename,
      contentType: file.type || "application/octet-stream",
      kind,
      role: extra?.role ?? roleForSlot(slotId, kind),
      ...extra,
    })
    mediaNames.push(file.name || filename)
    return file.name || filename
  }

  for (const slot of mapping.media ?? []) {
    if (slot.role === "refImage" || slot.role === "refVideo" || slot.role === "refAudio") {
      continue
    }
    const file = uploads.get(slot.id)
    if (!file) continue
    const name = await saveOne(slot.id, file, { role: slot.role, kind: slot.kind })
    if (slot.role === "firstFrame") firstFrameName = name
    if (slot.role === "lastFrame") lastFrameName = name
  }

  if (mapping.dynamicRefs) {
    const grouped: Record<MediaKind, Array<{ index: number; file: File }>> = {
      image: [],
      video: [],
      audio: [],
    }
    for (const [slotId, file] of uploads) {
      const parsed = parseRefSlotId(slotId)
      if (!parsed) continue
      grouped[parsed.kind].push({ index: parsed.index, file })
    }
    for (const kind of REF_KINDS) {
      const items = grouped[kind].sort((a, b) => a.index - b.index)
      if (items.length > REF_LIMITS[kind]) {
        throw new Error(`${refKindLabel(kind)}最多 ${REF_LIMITS[kind]} 个`)
      }
      for (let index = 0; index < items.length; index++) {
        await saveOne(refSlotId(kind, index), items[index].file, {
          kind,
          index,
          role: roleForSlot("", kind),
        })
      }
    }
  }

  return { inputMedia, mediaNames, firstFrameName, lastFrameName }
}

type LongUpload = {
  slotId: string
  file: File
  kind?: MediaKind
  index?: number
  role?: MediaRole
}

function collectScopedUploads(form: FormData, scope: "public" | "segment"): LongUpload[] {
  const prefix = `${scope}:`
  const found: LongUpload[] = []
  for (const [key, value] of form.entries()) {
    if (!(value instanceof File) || value.size <= 0) continue
    let rest = ""
    if (key.startsWith(`media:${prefix}`)) rest = key.slice(`media:${prefix}`.length)
    else if (key.startsWith(prefix)) rest = key.slice(prefix.length)
    else continue
    if (rest === "firstFrame") {
      found.push({ slotId: "firstFrame", file: value, kind: "image", role: "firstFrame" })
      continue
    }
    if (rest === "lastFrame") {
      found.push({ slotId: "lastFrame", file: value, kind: "image", role: "lastFrame" })
      continue
    }
    const parsed = parseRefSlotId(rest)
    if (parsed) {
      found.push({
        slotId: refSlotId(parsed.kind, parsed.index),
        file: value,
        kind: parsed.kind,
        index: parsed.index,
        role: roleForSlot("", parsed.kind),
      })
    }
  }
  return found
}

export async function persistLongMedia(
  jobId: string,
  form: FormData,
  options: {
    scope: "public" | "segment"
    segmentIndex?: number
    capabilities?: LongWorkflowCapabilities
  }
) {
  const uploads = collectScopedUploads(form, options.scope)
  const dir = path.join(jobOutputDir(jobId), "inputs")
  await fs.mkdir(dir, { recursive: true })

  const refs: StoredInputMedia[] = []
  let firstFrame: StoredInputMedia | undefined
  let lastFrame: StoredInputMedia | undefined

  for (const upload of uploads) {
    const prefix =
      options.scope === "public"
        ? `public-${upload.slotId}`
        : `seg${String(options.segmentIndex ?? 0).padStart(3, "0")}-${upload.slotId}`
    const filename = safeFileName(prefix, upload.file.name || `${upload.slotId}.bin`)
    const bytes = Buffer.from(await upload.file.arrayBuffer())
    await fs.writeFile(path.join(dir, filename), bytes)
    const stored: StoredInputMedia = {
      slotId: upload.slotId,
      file: filename,
      originalName: upload.file.name || filename,
      contentType: upload.file.type || "application/octet-stream",
      kind: upload.kind ?? kindFromContentType(upload.file.type),
      index: upload.index,
      role: upload.role,
      scope: options.scope,
      segmentIndex: options.segmentIndex,
    }
    if (upload.role === "firstFrame" || upload.slotId === "firstFrame") firstFrame = stored
    else if (upload.role === "lastFrame" || upload.slotId === "lastFrame") lastFrame = stored
    else refs.push(stored)
  }

  if (options.capabilities) {
    const allowed =
      options.scope === "public"
        ? options.capabilities.publicReferenceKinds
        : options.capabilities.segmentReferenceKinds
    for (const item of refs) {
      if (item.kind && !allowed.includes(item.kind)) {
        throw new Error(
          options.scope === "public"
            ? `公共锁定不支持${refKindLabel(item.kind)}`
            : `当前段不支持${refKindLabel(item.kind)}`
        )
      }
    }
    if (firstFrame && !options.capabilities.supportsFirstFrame) {
      throw new Error("当前工作流不支持首帧")
    }
    if (lastFrame && !options.capabilities.supportsLastFrame) {
      throw new Error("当前工作流不支持尾帧")
    }
  }

  return { refs, firstFrame, lastFrame }
}

export async function uploadStoredMedia(jobId: string, stored: StoredInputMedia[]): Promise<MediaPatch[]> {
  const dir = path.join(jobOutputDir(jobId), "inputs")
  const media: MediaPatch[] = []
  for (const item of stored) {
    const bytes = await fs.readFile(path.join(dir, item.file))
    const filename = await uploadInputFile(
      {
        filename: item.file,
        bytes,
        contentType: item.contentType || "application/octet-stream",
      },
      `上传${item.originalName}失败`
    )
    media.push({
      slotId: item.slotId,
      filename,
      kind: item.kind,
      index: item.index,
    })
  }
  return media
}

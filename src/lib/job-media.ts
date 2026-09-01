import fs from "node:fs/promises"
import path from "node:path"
import type { MediaKind, StoredInputMedia, WorkflowMapping } from "@/lib/types"
import { jobOutputDir } from "@/lib/paths"
import { REF_KINDS, REF_LIMITS, parseRefSlotId, refKindLabel, refSlotId } from "@/lib/refs"
import type { MediaPatch } from "@/lib/workflow-core"
import { uploadInputFile } from "@/lib/comfy"

function safeFileName(slotId: string, original: string) {
  const base = original.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file"
  const slot = slotId.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return `${slot}-${base}`
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
    extra?: Pick<StoredInputMedia, "kind" | "index">
  ) {
    const filename = safeFileName(slotId, file.name || `${slotId}.bin`)
    const bytes = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(path.join(dir, filename), bytes)
    inputMedia.push({
      slotId,
      file: filename,
      originalName: file.name || filename,
      contentType: file.type || "application/octet-stream",
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
    const name = await saveOne(slot.id, file)
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
        await saveOne(refSlotId(kind, index), items[index].file, { kind, index })
      }
    }
  }

  return { inputMedia, mediaNames, firstFrameName, lastFrameName }
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

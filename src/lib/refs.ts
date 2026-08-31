import type { MediaKind } from "@/lib/types"

export const REF_LIMITS = {
  image: 9,
  video: 3,
  audio: 3,
} as const

export const REF_KINDS = ["image", "video", "audio"] as const

const ROLE_BY_KIND = {
  image: "refImage",
  video: "refVideo",
  audio: "refAudio",
} as const

const KIND_BY_ROLE = {
  refImage: "image",
  refVideo: "video",
  refAudio: "audio",
} as const

export function refSlotId(kind: MediaKind, index: number) {
  return `${ROLE_BY_KIND[kind]}:${index}`
}

export function parseRefSlotId(
  slotId: string
): { kind: MediaKind; index: number } | null {
  const match = slotId.match(/^ref(Image|Video|Audio):(\d+)$/)
  if (!match) return null
  const role = `ref${match[1]}` as keyof typeof KIND_BY_ROLE
  return { kind: KIND_BY_ROLE[role], index: Number(match[2]) }
}

export function refPromptTag(kind: MediaKind, index: number) {
  const n = index + 1
  if (kind === "image") return `<Picture ${n}>`
  if (kind === "video") return `<Video ${n}>`
  return `<Audio ${n}>`
}

export function refKindLabel(kind: MediaKind) {
  if (kind === "image") return "参考图"
  if (kind === "video") return "参考视频"
  return "参考音频"
}

export function fileMatchesKind(file: File, kind: MediaKind) {
  if (kind === "video") return file.type.startsWith("video/")
  if (kind === "audio") return file.type.startsWith("audio/")
  return file.type.startsWith("image/")
}

export function kindFromFile(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  return null
}

export const WORKFLOW_ALIASES: Record<string, string> = {
  "h3-r2v-video.json": "h3-r2v.json",
}

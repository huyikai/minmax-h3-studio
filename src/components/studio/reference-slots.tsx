"use client"

import { useRef } from "react"
import { ImagePlusIcon, PlusIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription } from "@/components/ui/field"
import { LabelWithHelp } from "@/components/studio/field-help"
import { cn } from "@/lib/utils"
import type { MediaKind } from "@/lib/types"
import {
  REF_KINDS,
  REF_LIMITS,
  fileMatchesKind,
  kindFromFile,
  refKindLabel,
  refPromptTag,
} from "@/lib/refs"

export type RefDraft = {
  id: string
  kind: MediaKind
  file: File
  preview: string
}

type ReferenceSlotsProps = {
  drafts: RefDraft[]
  onAdd: (kind: MediaKind, files: File[]) => void
  onRemove: (id: string) => void
}

const ADD_OPTIONS: Array<{
  kind: MediaKind
  accept: string
}> = [
  { kind: "image", accept: "image/*" },
  { kind: "video", accept: "video/*" },
  { kind: "audio", accept: "audio/*" },
]

export function taggedRefs(drafts: RefDraft[]) {
  const counts: Record<MediaKind, number> = { image: 0, video: 0, audio: 0 }
  return drafts.map((draft) => {
    const index = counts[draft.kind]
    counts[draft.kind] += 1
    return {
      ...draft,
      index,
      tag: refPromptTag(draft.kind, index),
      label: `${refKindLabel(draft.kind)} ${index + 1}`,
    }
  })
}

export function ReferenceSlots({ drafts, onAdd, onRemove }: ReferenceSlotsProps) {
  const tagged = taggedRefs(drafts)
  const used = {
    image: drafts.filter((item) => item.kind === "image").length,
    video: drafts.filter((item) => item.kind === "video").length,
    audio: drafts.filter((item) => item.kind === "audio").length,
  }

  return (
    <Field
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        addDroppedFiles([...event.dataTransfer.files], onAdd)
      }}
      onPaste={(event) => {
        addDroppedFiles([...event.clipboardData.files], onAdd)
      }}
    >
      <LabelWithHelp label="参考">
        最多 {REF_LIMITS.image} 张图、{REF_LIMITS.video} 段视频、{REF_LIMITS.audio}{" "}
        段音频。提示词用 {refPromptTag("image", 0)}、{refPromptTag("video", 0)}、
        {refPromptTag("audio", 0)} 按类型顺序引用，并写清各自负责什么。
      </LabelWithHelp>

      {tagged.length > 0 ? (
        <div className="flex flex-col gap-3">
          {tagged.map((item) => (
            <div
              key={item.id}
              className="relative rounded-md border border-border/80 bg-monitor/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {item.tag}
                  </Badge>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {item.file.name}
                  </span>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  onClick={() => onRemove(item.id)}
                >
                  <XIcon />
                  <span className="sr-only">移除{item.label}</span>
                </Button>
              </div>
              {item.kind === "video" ? (
                <video
                  src={item.preview}
                  className="max-h-44 w-full rounded-md object-contain"
                  muted
                  playsInline
                  controls
                />
              ) : item.kind === "audio" ? (
                <audio src={item.preview} className="w-full" controls />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.preview}
                  alt={item.label}
                  className="max-h-44 w-full rounded-md object-contain"
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <DropTray />
      )}

      <div className="flex flex-wrap gap-2">
        {ADD_OPTIONS.map((option) => (
          <AddRefButton
            key={option.kind}
            kind={option.kind}
            accept={option.accept}
            used={used[option.kind]}
            limit={REF_LIMITS[option.kind]}
            onAdd={(files) => onAdd(option.kind, files)}
          />
        ))}
      </div>
      <FieldDescription>
        还可加图 {REF_LIMITS.image - used.image}、视频 {REF_LIMITS.video - used.video}
        、音频 {REF_LIMITS.audio - used.audio}。
      </FieldDescription>
    </Field>
  )
}

function DropTray() {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/80 bg-monitor/40 p-3 text-center">
      <ImagePlusIcon />
      <p className="max-w-[36ch] text-sm leading-relaxed text-muted-foreground text-pretty">
        拖入、粘贴图片、视频或音频。没有参考就只靠提示词。
      </p>
    </div>
  )
}

function AddRefButton({
  kind,
  accept,
  used,
  limit,
  onAdd,
}: {
  kind: MediaKind
  accept: string
  used: number
  limit: number
  onAdd: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const full = used >= limit
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={full}
        onClick={() => inputRef.current?.click()}
      >
        <PlusIcon data-icon="inline-start" />
        {refKindLabel(kind)}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ""
          if (files.length) onAdd(files.filter((file) => fileMatchesKind(file, kind)))
        }}
      />
    </>
  )
}

function addDroppedFiles(
  files: File[],
  onAdd: (kind: MediaKind, files: File[]) => void
) {
  const buckets: Record<MediaKind, File[]> = { image: [], video: [], audio: [] }
  for (const file of files) {
    const kind = kindFromFile(file)
    if (!kind) continue
    buckets[kind].push(file)
  }
  for (const kind of REF_KINDS) {
    if (buckets[kind].length) onAdd(kind, buckets[kind])
  }
}

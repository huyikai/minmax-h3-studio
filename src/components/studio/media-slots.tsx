"use client"

import { useRef } from "react"
import { ImagePlusIcon, VideoIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription } from "@/components/ui/field"
import { LabelWithHelp } from "@/components/studio/field-help"
import { cn } from "@/lib/utils"
import type { MediaSlot } from "@/lib/types"
import { fileMatchesKind } from "@/lib/refs"

export type SlotFile = {
  file: File
  preview: string
}

type MediaSlotsProps = {
  slots: MediaSlot[]
  files: Record<string, SlotFile>
  onChange: (slotId: string, file: File | null) => void
}

export function MediaSlots({ slots, files, onChange }: MediaSlotsProps) {
  if (slots.length === 0) return null
  return (
    <>
      {slots.map((slot) => (
        <MediaSlotField
          key={slot.id}
          slot={slot}
          current={files[slot.id]}
          onChange={(file) => onChange(slot.id, file)}
        />
      ))}
    </>
  )
}

function MediaSlotField({
  slot,
  current,
  onChange,
}: {
  slot: MediaSlot
  current?: SlotFile
  onChange: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const accept =
    slot.kind === "video"
      ? "video/*"
      : slot.kind === "audio"
        ? "audio/*"
        : "image/*"
  const isVideo = slot.kind === "video" && current?.file.type.startsWith("video/")

  return (
    <Field>
      <LabelWithHelp label={slot.label}>{slot.help}</LabelWithHelp>
      <div
        className={cn(
          "flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/80 bg-monitor/40 p-3 text-center",
          current && "items-stretch"
        )}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file && fileMatchesKind(file, slot.kind)) onChange(file)
        }}
        onPaste={(event) => {
          const file = [...event.clipboardData.files][0]
          if (file && fileMatchesKind(file, slot.kind)) onChange(file)
        }}
      >
        {current ? (
          <div className="relative">
            {isVideo ? (
              <video
                src={current.preview}
                className="max-h-44 w-full rounded-md object-contain"
                muted
                playsInline
                controls
              />
            ) : slot.kind === "audio" ? (
              <audio src={current.preview} className="w-full" controls />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.preview}
                alt={slot.label}
                className="max-h-44 w-full rounded-md object-contain"
              />
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={() => onChange(null)}
            >
              <XIcon />
              <span className="sr-only">移除{slot.label}</span>
            </Button>
          </div>
        ) : (
          <>
            {slot.kind === "video" ? <VideoIcon /> : <ImagePlusIcon />}
            <p className="max-w-[32ch] text-sm leading-relaxed text-muted-foreground text-pretty">
              拖入、粘贴或选择{slot.kind === "video" ? "视频" : slot.kind === "audio" ? "音频" : "图片"}。不放则不接入这个参考。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              选择文件
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) onChange(file)
          }}
        />
      </div>
      {current ? (
        <FieldDescription className="truncate font-mono text-[11px]">
          {current.file.name}
        </FieldDescription>
      ) : null}
    </Field>
  )
}

"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { LabelWithHelp } from "@/components/studio/field-help"
import { Field, FieldDescription } from "@/components/ui/field"
import { RESOLUTION_PRESETS } from "@/lib/types"
import { resolutionFor } from "@/lib/resolution"

export function ResolutionPicker({
  aspect,
  megapixels,
  disabled,
  onChange,
}: {
  aspect: string
  megapixels: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const resolution = resolutionFor(aspect, megapixels)

  return (
    <Field>
      <LabelWithHelp label="清晰度">
        按百万像素选择画布大小；选中后显示当前画幅的实际宽高。数字沿用 ComfyUI 的计算方式（1 MP = 1024²）。
      </LabelWithHelp>
      <ToggleGroup
        type="single"
        value={String(megapixels)}
        onValueChange={(value) => {
          if (value) onChange(Number(value))
        }}
        variant="outline"
        size="sm"
        className="flex-wrap"
        disabled={disabled}
      >
        {RESOLUTION_PRESETS.map((item) => (
          <ToggleGroupItem
            key={item}
            value={String(item)}
            className="font-mono tabular-nums data-[state=on]:border-primary/70 data-[state=on]:bg-primary/15"
          >
            {item === 0.98 ? "0.98" : item.toFixed(1)}
            {item > 1 ? " 超" : ""}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <FieldDescription className="font-mono tabular-nums">
        {resolution.width}×{resolution.height}
        {resolution.oversize ? (
          <span className="ml-2 font-sans text-muted-foreground">
            超过原生画布，更耗显存和时间，细节不一定更好。
          </span>
        ) : null}
      </FieldDescription>
    </Field>
  )
}

"use client"

import type { ReactNode } from "react"
import { CircleHelpIcon } from "lucide-react"
import { FieldLabel } from "@/components/ui/field"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function FieldHelp({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        aria-label={`${label}是什么`}
      >
        <CircleHelpIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[32ch] text-pretty leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

export function LabelWithHelp({
  htmlFor,
  label,
  children,
}: {
  htmlFor?: string
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      <FieldHelp label={label}>{children}</FieldHelp>
    </div>
  )
}

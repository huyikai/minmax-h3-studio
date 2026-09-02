"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const indeterminate = value == null
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-indeterminate={indeterminate ? "" : undefined}
      {...props}
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        indeterminate && "progress-indeterminate",
        className
      )}
      value={indeterminate ? undefined : value}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full bg-primary",
          indeterminate
            ? "absolute inset-y-0 left-0 w-[36%]"
            : "size-full flex-1 transition-all"
        )}
        style={
          indeterminate
            ? undefined
            : { transform: `translateX(-${100 - (value || 0)}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }

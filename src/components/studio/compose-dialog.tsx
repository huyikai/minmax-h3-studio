"use client"

import type { ReactNode } from "react"
import { PlayIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

type ComposeDialogProps = {
  open: boolean
  title: string
  hint: string
  generateDisabled: boolean
  generateLabel: string
  submitting: boolean
  children: ReactNode
  guide?: ReactNode
  onOpenChange: (open: boolean) => void
  onGenerate: () => void
}

export function ComposeDialog({
  open,
  title,
  hint,
  generateDisabled,
  generateLabel,
  submitting,
  children,
  guide,
  onOpenChange,
  onGenerate,
}: ComposeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="pointer-events-none top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 overflow-visible rounded-none bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
        onPointerDownOutside={(event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest("[data-prompt-guide]")) event.preventDefault()
        }}
        onFocusOutside={(event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest("[data-prompt-guide]")) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest("[data-prompt-guide]")) event.preventDefault()
        }}
      >
        <div className="flex h-auto max-h-[90dvh] w-fit max-w-[calc(100%-2rem)] items-stretch gap-3">
          <div className="pointer-events-auto relative flex min-h-0 w-[min(32rem,calc(100vw-2rem))] max-w-lg flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground ring-1 ring-foreground/10">
            <DialogHeader className="shrink-0 space-y-0 border-b px-4 py-3 pr-12">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="sr-only">{hint}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
            <DialogFooter className="mx-0 mb-0 flex-col gap-3 rounded-none sm:flex-col sm:items-stretch">
              <p className="text-xs leading-relaxed text-muted-foreground text-pretty">{hint}</p>
              <Button
                type="button"
                size="lg"
                className="h-11 w-full"
                disabled={generateDisabled}
                onClick={onGenerate}
              >
                {submitting ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlayIcon data-icon="inline-start" />
                )}
                {generateLabel}
              </Button>
            </DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">关闭</span>
              </Button>
            </DialogClose>
          </div>
          {guide}
        </div>
      </DialogContent>
    </Dialog>
  )
}

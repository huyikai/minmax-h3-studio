"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CopyIcon, ExternalLinkIcon, PinIcon, PinOffIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import {
  applySectionInsert,
  formatGuidePack,
  guideOfficialUrl,
  guidePanelTitle,
  guideRules,
  guideSections,
  sectionBody,
  sectionGloss,
  sectionPurpose,
  type GuideMode,
  type GuideSectionId,
} from "@/lib/prompt-guide"

type PromptGuideProps = {
  open: boolean
  pinned: boolean
  mode: GuideMode
  duration: number
  prompt: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  disabled?: boolean
  compact?: boolean
  docked?: boolean
  extraTitle?: string
  extraRules?: string[]
  monitorRef?: React.RefObject<HTMLElement | null>
  onPinnedChange: (pinned: boolean) => void
  onClose: () => void
  onApply: (next: string, selection: { start: number; end: number }) => void
}

export function PromptGuide({
  open,
  pinned,
  mode,
  duration,
  prompt,
  textareaRef,
  disabled,
  compact = false,
  docked = false,
  extraTitle,
  extraRules,
  monitorRef,
  onPinnedChange,
  onClose,
  onApply,
}: PromptGuideProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [desktop, setDesktop] = useState(false)
  const [box, setBox] = useState<DOMRect | null>(null)

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)")
    const sync = () => setDesktop(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  useLayoutEffect(() => {
    if (!open || !desktop || docked) return
    function update() {
      if (compact) {
        const monitor = monitorRef?.current?.getBoundingClientRect()
        if (monitor) {
          setBox(
            new DOMRect(
              monitor.right - 288 - 16,
              monitor.bottom - 72 - 16,
              288,
              72
            )
          )
          return
        }
      }
      const textarea = textareaRef.current?.getBoundingClientRect()
      if (!textarea) return
      const preferredLeft = textarea.right + 12
      const width = Math.min(420, Math.max(280, window.innerWidth - preferredLeft - 16))
      const left =
        preferredLeft + width <= window.innerWidth - 16
          ? preferredLeft
          : Math.max(16, window.innerWidth - 16 - width)
      const maxHeight = Math.min(
        window.innerHeight * 0.58,
        window.innerHeight - textarea.top - 16
      )
      setBox(new DOMRect(left, textarea.top, width, Math.max(220, maxHeight)))
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [open, desktop, compact, docked, textareaRef, monitorRef])

  useEffect(() => {
    if (!open || pinned) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (textareaRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open, pinned, onClose, textareaRef])

  function insert(id: GuideSectionId) {
    if (disabled) return
    const result = applySectionInsert(prompt, mode, id, duration)
    onApply(result.text, result.selection)
  }

  async function copyPack() {
    try {
      await navigator.clipboard.writeText(formatGuidePack(mode, duration))
      toast.success("已复制当前写法")
    } catch {
      toast.error("复制失败")
    }
  }

  const body = (
    <GuideBody
      mode={mode}
      duration={duration}
      compact={compact && desktop}
      pinned={pinned}
      disabled={disabled}
      extraTitle={extraTitle}
      extraRules={extraRules}
      onPinnedChange={onPinnedChange}
      onInsert={insert}
      onCopy={() => void copyPack()}
    />
  )

  if (!open) return null

  if (!desktop) {
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            onPinnedChange(false)
            onClose()
          }
        }}
      >
        <SheetContent
          side="bottom"
          data-prompt-guide=""
          className="z-[70] max-h-[70dvh] gap-0 overflow-hidden p-0"
          showCloseButton
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHeader className="border-b">
            <SheetTitle>写法 · {guidePanelTitle(mode)}</SheetTitle>
            <SheetDescription>
              点英文骨架写入提示词。灰色中文只对照，不会插入。
            </SheetDescription>
          </SheetHeader>
          <div
            data-prompt-guide-scroll=""
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
          >
            {body}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  if (docked) {
    return (
      <div
        ref={panelRef}
        data-prompt-guide=""
        role="complementary"
        aria-label="提示词写法"
        className="pointer-events-auto flex w-80 min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border bg-card/95 shadow-lg"
        onMouseDown={(event) => {
          const target = event.target as HTMLElement
          if (target.closest("a")) return
          if (target.closest("[data-prompt-guide-scroll]")) return
          event.preventDefault()
        }}
      >
        {body}
      </div>
    )
  }

  if (!box) return null

  return createPortal(
    <div
      ref={panelRef}
      data-prompt-guide=""
      role="complementary"
      aria-label="提示词写法"
      className={cn(
        "fixed z-[70] overflow-hidden rounded-xl border bg-card/95 shadow-lg backdrop-blur-sm",
        compact && "cursor-pointer"
      )}
      style={{
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      }}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement
        if (target.closest("a")) return
        if (target.closest("[data-prompt-guide-scroll]")) return
        event.preventDefault()
      }}
    >
      {body}
    </div>,
    document.body
  )
}

function GuideBody({
  mode,
  duration,
  compact,
  pinned,
  disabled,
  extraTitle,
  extraRules,
  onPinnedChange,
  onInsert,
  onCopy,
}: {
  mode: GuideMode
  duration: number
  compact: boolean
  pinned: boolean
  disabled?: boolean
  extraTitle?: string
  extraRules?: string[]
  onPinnedChange: (pinned: boolean) => void
  onInsert: (id: GuideSectionId) => void
  onCopy: () => void
}) {
  const sections = guideSections(mode)
  const baseRules = guideRules(mode)
  const rules = extraRules ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-sm font-medium">
          写法 · {guidePanelTitle(mode)}
          {compact ? "（钉住）" : null}
        </p>
        <Button
          type="button"
          size="sm"
          variant={pinned ? "secondary" : "ghost"}
          onClick={() => onPinnedChange(!pinned)}
        >
          {pinned ? (
            <PinOffIcon data-icon="inline-start" />
          ) : (
            <PinIcon data-icon="inline-start" />
          )}
          {pinned ? "取消钉住" : "钉住"}
        </Button>
      </div>
      {compact ? null : (
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <Button type="button" size="sm" variant="ghost" asChild>
            <a
              href={guideOfficialUrl(mode)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon data-icon="inline-start" />
              原指南
            </a>
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCopy}>
            <CopyIcon data-icon="inline-start" />
            复制全部
          </Button>
        </div>
      )}
      {compact ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          生成中已收到角上，避免挡住进度。
        </p>
      ) : (
        <div
          data-prompt-guide-scroll=""
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="flex flex-col gap-3 p-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground text-pretty">
              点英文骨架写入输入框。已经有的字段会选中，不会再插一份。灰色中文不会写进去。
            </p>
            {extraTitle ? (
              <div className="rounded-md border border-primary/25 bg-primary/5 p-2.5">
                <p className="text-xs font-medium text-foreground">{extraTitle}</p>
                <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                  {rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              {baseRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <div className="flex flex-col gap-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  disabled={disabled}
                  className={cn(
                    "rounded-md border border-border/80 bg-muted p-2.5 text-left transition-colors",
                    disabled
                      ? "cursor-not-allowed opacity-60"
                      : "hover:border-primary/50 hover:bg-primary/5"
                  )}
                  onClick={() => onInsert(section.id)}
                >
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs font-medium">{section.label}</span>
                    {section.fieldName ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {section.fieldName}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">首行指令</span>
                    )}
                  </span>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
                    {sectionPurpose(mode, section.id)}
                  </p>
                  <pre className="mt-2 max-h-28 overflow-hidden font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                    {sectionBody(mode, section.id, duration)}
                  </pre>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80 text-pretty">
                    {sectionGloss(mode, section.id, duration)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

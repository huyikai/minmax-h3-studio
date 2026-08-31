"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CopyIcon, ExternalLinkIcon, PinIcon, PinOffIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  compact: boolean
  mode: GuideMode
  duration: number
  prompt: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  monitorRef: React.RefObject<HTMLElement | null>
  onPinnedChange: (pinned: boolean) => void
  onClose: () => void
  onApply: (next: string, selection: { start: number; end: number }) => void
}

export function PromptGuide({
  open,
  pinned,
  compact,
  mode,
  duration,
  prompt,
  textareaRef,
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
    if (!open || !desktop) return
    function update() {
      if (compact) {
        const monitor = monitorRef.current?.getBoundingClientRect()
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
  }, [open, desktop, compact, textareaRef, monitorRef])

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
          className="max-h-[70dvh] gap-0 p-0"
          showCloseButton
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHeader className="border-b">
            <SheetTitle>写法 · {guidePanelTitle(mode)}</SheetTitle>
            <SheetDescription>
              点英文骨架写入提示词。灰色中文只对照，不会插入。
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
        </SheetContent>
      </Sheet>
    )
  }

  if (!box) return null

  return createPortal(
    <div
      ref={panelRef}
      role="complementary"
      aria-label="提示词写法"
      className={cn(
        "fixed z-40 overflow-hidden rounded-xl border bg-card/95 shadow-lg backdrop-blur-sm",
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
        const slot = target.closest("[data-slot]")
        if (slot?.getAttribute("data-slot") === "scroll-area-thumb") return
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
  onPinnedChange,
  onInsert,
  onCopy,
}: {
  mode: GuideMode
  duration: number
  compact: boolean
  pinned: boolean
  onPinnedChange: (pinned: boolean) => void
  onInsert: (id: GuideSectionId) => void
  onCopy: () => void
}) {
  const sections = guideSections(mode)
  const rules = guideRules(mode)

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
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-3">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              {rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <div className="flex flex-col gap-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className="rounded-md border border-border/80 bg-monitor/40 p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
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
            <p className="text-[11px] text-muted-foreground">
              点英文骨架写入输入框。已经有的字段会选中，不会再插一份。灰色中文不会写进去。
            </p>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

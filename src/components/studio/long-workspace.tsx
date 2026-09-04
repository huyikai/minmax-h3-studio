"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircleIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Clock3Icon,
  ListFilterIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCcwIcon,
  UnlinkIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import {
  Field,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { LabelWithHelp } from "@/components/studio/field-help"
import { ASPECT_PRESETS, DURATION_OPTIONS, LONG_STEP_OPTIONS } from "@/lib/types"
import { ResolutionPicker } from "@/components/studio/resolution-picker"
import type { LongSegment, PublicJob } from "@/lib/types"
import type { WorkflowListItem } from "@/lib/default-workflows"
import { isBusyJob } from "@/lib/job-view"
import {
  canDispatchLongSegment,
  expectedLongSegmentIndex,
  hasUnfinishedSegments,
  lastSuccessfulSegment,
  laterSegments,
  liveSegments,
  mergeLockIntoPrompt,
  nextClipIndex,
  queuedLongSegments,
  retryableSegment,
  runningLongSegment,
  successfulSegments,
} from "@/lib/long-video"
import { cn } from "@/lib/utils"

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000)
}

type SegmentFilter = "all" | "pending" | "running" | "success" | "failed" | "voided"

type SegmentStatusBadgeProps = {
  status: string
  blocked?: boolean
}

function SegmentStatusBadge({ status, blocked }: SegmentStatusBadgeProps) {
  const config =
    blocked && status === "waiting"
      ? {
          label: "等待前段",
          icon: UnlinkIcon,
          className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        }
      : status === "waiting"
        ? {
            label: "待处理",
            icon: Clock3Icon,
            className: "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
          }
        : status === "queued"
          ? {
              label: "排队中",
              icon: ListFilterIcon,
              className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
            }
          : status === "running"
            ? {
                label: "生成中",
                icon: LoaderCircleIcon,
                className: "border-primary/30 bg-primary/10 text-primary",
              }
            : status === "success"
              ? {
                  label: "完成",
                  icon: CheckCircle2Icon,
                  className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                }
              : status === "error"
                ? {
                    label: "失败",
                    icon: AlertCircleIcon,
                    className: "border-destructive/30 bg-destructive/10 text-destructive",
                  }
                : status === "interrupted"
                  ? {
                      label: "已中断",
                      icon: RotateCcwIcon,
                      className: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
                    }
                  : {
                      label: "已作废",
                      icon: ChevronDownIcon,
                      className: "border-muted-foreground/30 bg-muted text-muted-foreground",
                    }
  const Icon = config.icon

  return (
    <Badge variant="outline" className={cn("h-6 gap-1 rounded-md px-2", config.className)}>
      <Icon className={cn("size-3.5", status === "running" && "animate-spin")} />
      {config.label}
    </Badge>
  )
}

function formatSegmentIndexes(indexes: number[]) {
  const sorted = [...indexes].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (const index of sorted.slice(1)) {
    if (index === end + 1) {
      end = index
      continue
    }
    ranges.push(start === end ? `第 ${start} 段` : `第 ${start}-${end} 段`)
    start = index
    end = index
  }
  if (start !== undefined) {
    ranges.push(start === end ? `第 ${start} 段` : `第 ${start}-${end} 段`)
  }
  return ranges.join("、")
}

function segmentStatusCounts(segments: LongSegment[]) {
  const counts = new Map<string, number>()
  for (const segment of segments) {
    counts.set(segment.status, (counts.get(segment.status) ?? 0) + 1)
  }
  return [
    ["success", "已完成"],
    ["queued", "排队中"],
    ["waiting", "等待前段"],
    ["running", "生成中"],
    ["error", "失败"],
    ["interrupted", "已中断"],
  ]
    .flatMap(([status, label]) => {
      const count = counts.get(status) ?? 0
      return count > 0 ? [`${label} ${count} 段`] : []
    })
    .join("，")
}

function SegmentSummary({
  index,
  duration,
  seed,
  status,
  prompt,
  blocked,
  expanded,
  onTogglePrompt,
  onViewSegment,
}: {
  index: number
  duration: number
  seed: number
  status: string
  prompt: string
  blocked?: boolean
  expanded: boolean
  onTogglePrompt: () => void
  onViewSegment?: () => void
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {onViewSegment ? (
          <button
            type="button"
            className="font-mono text-[11px] tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={onViewSegment}
          >
            第 {index} 段 · {duration}s · seed {seed}
          </button>
        ) : (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            第 {index} 段 · {duration}s · seed {seed}
          </span>
        )}
        <SegmentStatusBadge status={status} blocked={blocked} />
      </div>
      <button
        type="button"
        className={cn(
          "mt-1 block w-full text-left text-xs text-muted-foreground hover:text-foreground",
          expanded ? "whitespace-pre-wrap" : "line-clamp-2"
        )}
        onClick={onTogglePrompt}
        aria-label={expanded ? `收起第 ${index} 段提示词` : `展开第 ${index} 段提示词`}
      >
        {prompt || "（无提示词）"}
      </button>
      <span className="mt-1 block text-[10px] text-muted-foreground/70">
        {expanded ? "点击收起提示词" : "点击展开提示词"}
      </span>
    </div>
  )
}

export type LongGeneratePayload = {
  prompt: string
  duration: number
  aspect: string
  megapixels: number
  seed: number
  lockPrompt: string
  steps: number
  redoIndex?: number
}

export function LongWorkspace({
  job,
  submitting,
  prompt,
  textareaRef,
  pastSegmentIndex,
  focusSegmentIndex,
  onViewSegment,
  onPromptChange,
  onPromptFocus,
  onGenerate,
  onFinalize,
  onReopen,
  workflows,
  onWorkflowChange,
}: {
  job: PublicJob
  submitting: boolean
  prompt: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  pastSegmentIndex?: number | null
  focusSegmentIndex?: number | null
  onViewSegment?: (index: number) => void
  onPromptChange: (value: string | ((prev: string) => string)) => void
  onPromptFocus?: () => void
  onGenerate: (payload: LongGeneratePayload) => Promise<boolean>
  onFinalize: () => void
  onReopen: () => void
  workflows: WorkflowListItem[]
  onWorkflowChange: (name: string) => void
}) {
  const long = job.long
  const busy = isBusyJob(job)
  const finalized = Boolean(long?.finalized)
  const aspectLocked = Boolean(long?.aspectLocked)
  const retry = retryableSegment(long)
  const nextIndex = nextClipIndex(long)
  const successCount = successfulSegments(long).length
  const unfinished = hasUnfinishedSegments(long)

  const [lockPrompt, setLockPrompt] = useState(long?.lockPrompt ?? "")
  const [duration, setDuration] = useState("5")
  const [aspect, setAspect] = useState(job.aspect)
  const [megapixels, setMegapixels] = useState(job.megapixels ?? 0.98)
  const [steps, setSteps] = useState(String(job.steps ?? 20))
  const [seed, setSeed] = useState(randomSeed())
  const [randomize, setRandomize] = useState(true)
  const [redoIndex, setRedoIndex] = useState<number | null>(null)
  const [redoConfirmIndex, setRedoConfirmIndex] = useState<number | null>(null)
  const [redoSubmitOpen, setRedoSubmitOpen] = useState(false)
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>("all")
  const [expandedSegments, setExpandedSegments] = useState<Set<number>>(new Set())
  const [voidedOpen, setVoidedOpen] = useState(false)
  const segmentRefs = useRef<Record<number, HTMLLIElement | null>>({})
  const segmentListRef = useRef<HTMLDivElement | null>(null)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const filterScrollPositions = useRef<Partial<Record<SegmentFilter, number>>>({})
  const lastAutoScrollTarget = useRef<string | null>(null)
  const previousFilter = useRef<SegmentFilter>("all")

  const segments = liveSegments(long)
  const voidedSegments = (long?.segments ?? [])
    .filter((item) => item.status === "voided")
    .sort((a, b) => a.index - b.index)
  const runningSegment = runningLongSegment(long)
  const queuedSegments = queuedLongSegments(long)
  const expectedIndex = expectedLongSegmentIndex(long)
  const displayFilter =
    focusSegmentIndex != null &&
    segmentFilter !== "all" &&
    (segmentFilter === "voided"
      ? !voidedSegments.some((segment) => segment.index === focusSegmentIndex)
      : !segments.some((segment) => segment.index === focusSegmentIndex))
      ? "all"
      : segmentFilter
  const filterSegments = useMemo(() => {
    if (displayFilter === "voided") return voidedSegments
    return segments.filter((segment) => {
      if (displayFilter === "all") return true
      if (displayFilter === "pending") {
        return segment.status === "waiting" || segment.status === "queued"
      }
      if (displayFilter === "running") return segment.status === "running"
      if (displayFilter === "success") return segment.status === "success"
      return segment.status === "error" || segment.status === "interrupted"
    })
  }, [displayFilter, segments, voidedSegments])
  const pendingCount = queuedSegments.length
  const currentStatusTarget =
    runningSegment?.index ?? focusSegmentIndex ?? retry?.index ?? redoConfirmIndex
  const hiddenCurrent =
    currentStatusTarget !== null &&
    currentStatusTarget !== undefined &&
    !filterSegments.some((segment) => segment.index === currentStatusTarget)

  useEffect(() => {
    if (currentStatusTarget == null || hiddenCurrent) return
    const target = `${currentStatusTarget}:${displayFilter}:${filterSegments.length}`
    if (lastAutoScrollTarget.current === target) return
    const node = segmentRefs.current[currentStatusTarget]
    if (!node) return
    lastAutoScrollTarget.current = target
    node.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [currentStatusTarget, displayFilter, filterSegments, hiddenCurrent])

  useEffect(() => {
    const previous = previousFilter.current
    if (previous === segmentFilter) return
    const editor = editorScrollRef.current
    if (editor) filterScrollPositions.current[previous] = editor.scrollTop
    previousFilter.current = segmentFilter
    const saved = filterScrollPositions.current[segmentFilter]
    if (saved === undefined || !editor) return
    window.requestAnimationFrame(() => {
      editor.scrollTop = saved
    })
  }, [segmentFilter])

  function handleFilterChange(next: SegmentFilter) {
    const editor = editorScrollRef.current
    if (editor) filterScrollPositions.current[segmentFilter] = editor.scrollTop
    setSegmentFilter(next)
  }

  useEffect(() => {
    onPromptChange("")
  }, [job.id, onPromptChange])

  const retryIndex = retry?.index
  const retryStatus = retry?.status
  const retryPrompt = retry?.prompt
  const retryDuration = retry?.duration
  const retrySeed = retry?.seed
  useEffect(() => {
    if (
      retryIndex == null ||
      retryPrompt == null ||
      retryDuration == null ||
      retrySeed == null
    ) {
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- server status changes must hydrate the retry editor once.
    setRedoIndex(null)
    onPromptChange(retryPrompt)
    setDuration(String(retryDuration))
    setSeed(retrySeed)
    setRandomize(false)
  }, [
    job.id,
    onPromptChange,
    retryDuration,
    retryIndex,
    retryPrompt,
    retrySeed,
    retryStatus,
  ])

  const lastSuccess = lastSuccessfulSegment(long)
  const completedPrompt = lastSuccess?.prompt
  const hasWaitingSegments = liveSegments(long).some(
    (item) => item.status === "waiting"
  )
  useEffect(() => {
    if (
      !completedPrompt ||
      retryIndex != null ||
      busy ||
      finalized ||
      hasWaitingSegments
    ) {
      return
    }
    onPromptChange((prev) =>
      prev.trim() === completedPrompt.trim() ? "" : prev
    )
  }, [
    busy,
    completedPrompt,
    finalized,
    hasWaitingSegments,
    onPromptChange,
    retryIndex,
  ])

  const redoConfirmSegments =
    redoConfirmIndex === null ? [] : laterSegments(long, redoConfirmIndex)
  const redoConfirmTail = redoConfirmSegments.length

  function beginRedo(index: number) {
    const segment = (long?.segments ?? []).find((item) => item.index === index)
    if (!segment) return
    setRedoIndex(index)
    onPromptChange(segment.prompt)
    setDuration(String(segment.duration))
    setSeed(segment.seed)
    setRandomize(false)
    setRedoConfirmIndex(null)
  }

  async function submitGenerate() {
    const nextSeed = randomize ? randomSeed() : seed
    if (randomize) setSeed(nextSeed)
    const ok = await onGenerate({
      prompt,
      duration: Number(duration),
      aspect,
      megapixels,
      seed: nextSeed,
      lockPrompt,
      steps: Number(steps) || 20,
      redoIndex: redoIndex ?? retry?.index,
    })
    if (!ok) return
    onPromptChange("")
    setRedoIndex(null)
  }

  const submittedPreview = useMemo(
    () => mergeLockIntoPrompt(lockPrompt, prompt),
    [lockPrompt, prompt]
  )
  const targetIndex = redoIndex ?? nextIndex
  const settingsLocked = aspectLocked && targetIndex > 1
  const readOnly = finalized
  const laterCount = laterSegments(long, targetIndex).length
  const generateDisabled =
    readOnly || submitting || !prompt.trim() || Boolean(retry && targetIndex > retry.index)
  const needsSubmitConfirm = laterCount > 0 || redoIndex !== null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={editorScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
        <FieldGroup className="py-4">
          <Field>
            <LabelWithHelp htmlFor="long-lock" label="公共锁定">
              只拼到每一段 integrated_multimodal_description 的开头。环境音和配乐仍按段写。可空。
            </LabelWithHelp>
            <Textarea
              id="long-lock"
              value={lockPrompt}
              onChange={(event) => setLockPrompt(event.target.value)}
              placeholder="身份、服装、光线等整条片子要锁住的句子"
              className="min-h-24"
              disabled={readOnly}
            />
          </Field>

          <Field>
            <LabelWithHelp label="长视频工作流">
              创建后锁定。当前仅显示已接入 Motion Context 的长视频工作流。
            </LabelWithHelp>
            <div className="flex flex-col gap-1.5">
              {workflows.filter((item) => item.family === "long").map((item) => (
                <button
                  key={item.name}
                  type="button"
                  disabled={readOnly}
                  onClick={() => onWorkflowChange(item.name)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    job.workflowFile === item.name
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/50",
                    readOnly && "cursor-not-allowed opacity-60"
                  )}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                </button>
              ))}
              {workflows.every((item) => item.family !== "long") ? (
                <p className="text-xs text-muted-foreground">暂无其他长视频工作流。</p>
              ) : null}
            </div>
          </Field>
          <Field>
            <div
              id="long-segment-list"
              ref={segmentListRef}
              className="flex flex-col gap-3"
            >
              <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 border-b bg-card px-1 py-2 shadow-sm">
                <div>
                  <LabelWithHelp label="段落列表">
                    已完成、排队中和等待前段的内容都会显示。重写某一段会丢掉它后面的输入、队列和成片。
                  </LabelWithHelp>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                    <span>当前生成：{runningSegment ? `第 ${runningSegment.index} 段` : "无"}</span>
                    <span>排队：{pendingCount} 段</span>
                    <span>预计到：第 {expectedIndex || 1} 段</span>
                  </div>
                </div>
                {hiddenCurrent ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleFilterChange("all")}
                  >
                    显示当前段
                  </Button>
                ) : null}
              </div>
              <div className="-mx-1 flex max-w-full overflow-x-auto px-1 pb-1">
                <div className="flex min-w-max gap-1" role="tablist" aria-label="段落状态筛选">
                  {([
                    ["all", "全部", segments.length],
                    ["pending", "待处理", segments.filter((item) => item.status === "waiting" || item.status === "queued").length],
                    ["running", "生成中", segments.filter((item) => item.status === "running").length],
                    ["success", "已完成", segments.filter((item) => item.status === "success").length],
                    ["failed", "失败 / 中断", segments.filter((item) => item.status === "error" || item.status === "interrupted").length],
                    ["voided", "已作废", voidedSegments.length],
                  ] as const).map(([value, label, count]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={displayFilter === value ? "secondary" : "ghost"}
                      role="tab"
                      aria-selected={displayFilter === value}
                      onClick={() => handleFilterChange(value)}
                    >
                      {label} <span className="font-mono text-[10px] tabular-nums">{count}</span>
                    </Button>
                  ))}
                </div>
              </div>
              <ul className="flex flex-col gap-1.5">
                {filterSegments.length === 0 ? (
                  <li className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    {segments.length === 0 ? "还没有段。下面写第 1 段。" : "当前筛选没有段落。"}
                  </li>
                ) : (
                  filterSegments.map((segment) => {
                    const blocked =
                      segment.status === "waiting" &&
                      !canDispatchLongSegment(long, segment.index)
                    const expanded = expandedSegments.has(segment.index)
                    return (
                      <li
                        key={segment.index}
                        ref={(node) => {
                          segmentRefs.current[segment.index] = node
                        }}
                        className={cn(
                          "flex items-start justify-between gap-2 rounded-md border border-l-4 px-3 py-2",
                          segment.status === "waiting" &&
                            blocked && "border-l-amber-500 bg-amber-500/5",
                          segment.status === "waiting" &&
                            !blocked && "border-l-slate-400 bg-slate-500/5",
                          segment.status === "queued" && "border-l-sky-500 bg-sky-500/5",
                          segment.status === "running" && "border-l-primary bg-primary/10",
                          segment.status === "success" && "border-l-emerald-500 bg-emerald-500/5",
                          (segment.status === "error" || segment.status === "interrupted") &&
                            "border-l-destructive bg-destructive/5",
                          segment.status === "voided" && "border-l-muted-foreground opacity-60",
                          segment.status === "success" &&
                            pastSegmentIndex === segment.index &&
                            "border-primary/70 bg-primary/10"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <SegmentSummary
                            index={segment.index}
                            duration={segment.duration}
                            seed={segment.seed}
                            status={segment.status}
                            prompt={segment.prompt}
                            blocked={blocked}
                            expanded={expanded}
                            onViewSegment={
                              segment.status === "success" && onViewSegment
                                ? () => onViewSegment(segment.index)
                                : undefined
                            }
                            onTogglePrompt={() => {
                              setExpandedSegments((current) => {
                                const next = new Set(current)
                                if (next.has(segment.index)) next.delete(segment.index)
                                else next.add(segment.index)
                                return next
                              })
                            }}
                          />
                        </div>
                        {segment.status !== "voided" && !finalized ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="shrink-0"
                            onClick={() => setRedoConfirmIndex(segment.index)}
                          >
                            重写
                          </Button>
                        ) : null}
                      </li>
                    )
                  })
                )}
              </ul>
              {voidedSegments.length > 0 && segmentFilter !== "voided" ? (
                <div className="rounded-md border border-dashed">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground"
                    onClick={() => setVoidedOpen((open) => !open)}
                    aria-expanded={voidedOpen}
                  >
                    <span className="flex items-center gap-2"><ArchiveIcon className="size-3.5" />已作废 {voidedSegments.length} 段</span>
                    <ChevronDownIcon className={cn("size-4 transition-transform", voidedOpen && "rotate-180")} />
                  </button>
                  {voidedOpen ? (
                    <ul className="flex flex-col gap-1 border-t p-2">
                      {voidedSegments.map((segment) => (
                        <li key={segment.index} className="rounded-md bg-muted/50 px-2.5 py-2">
                          <SegmentSummary
                            index={segment.index}
                            duration={segment.duration}
                            seed={segment.seed}
                            status={segment.status}
                            prompt={segment.prompt}
                            expanded={expandedSegments.has(segment.index)}
                            onTogglePrompt={() => {
                              setExpandedSegments((current) => {
                                const next = new Set(current)
                                if (next.has(segment.index)) next.delete(segment.index)
                                else next.add(segment.index)
                                return next
                              })
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Field>

          <Field>
            <div className="flex items-baseline justify-between gap-3">
              <LabelWithHelp htmlFor="long-prompt" label={`第 ${targetIndex} 段提示词`}>
                官方文生字段。下一段先用大约 2 秒接住上一镜结尾，再开新动作（气闸）。
              </LabelWithHelp>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {prompt.length}
              </span>
            </div>
            <Textarea
              ref={textareaRef}
              id="long-prompt"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onFocus={onPromptFocus}
              placeholder="聚焦后右侧显示写法"
              className="min-h-44"
              disabled={readOnly}
            />
            <FieldDescription>
              {redoIndex
                ? `将重写第 ${redoIndex} 段，并丢掉后面的段。重新提交后排到队尾。`
                : retry
                  ? laterCount > 0
                    ? `第 ${retry.index} 段失败或中断，后面的段先挂着。重提会丢掉后面，并排到队尾。`
                    : `重提第 ${retry.index} 段。`
                  : `生成第 ${targetIndex} 段，提交后进入队列。`}
            </FieldDescription>
          </Field>

          {prompt.trim() && lockPrompt.trim() ? (
            <Field>
              <LabelWithHelp label="实际提交">
                公共锁定会写在 integrated_multimodal_description 开头。环境音和配乐不动。
              </LabelWithHelp>
              <pre className="max-h-40 overflow-auto rounded-md border bg-muted p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {submittedPreview}
              </pre>
            </Field>
          ) : null}

          <Field>
            <LabelWithHelp label="时长">
              未生成的段可以改。改已经成功的段等于重做，并丢掉后面的段。
            </LabelWithHelp>
            <ToggleGroup
              type="single"
              value={duration}
              onValueChange={(value) => {
                if (value) setDuration(value)
              }}
              variant="outline"
              size="sm"
              className="flex-wrap"
              disabled={readOnly}
            >
              {DURATION_OPTIONS.map((item) => (
                <ToggleGroupItem
                  key={item}
                  value={String(item)}
                  className="font-mono tabular-nums data-[state=on]:border-primary/70 data-[state=on]:bg-primary/15"
                >
                  {item}s
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <LabelWithHelp label="画幅">
              第一段提交后锁定。重写第 1 段时可改画幅、清晰度和步数。整条链必须同一分辨率。
            </LabelWithHelp>
            <ToggleGroup
              type="single"
              value={aspect}
              onValueChange={(value) => {
                if (value) setAspect(value)
              }}
              variant="outline"
              size="sm"
              className="flex-wrap"
              disabled={readOnly || settingsLocked}
            >
              {ASPECT_PRESETS.map((item) => (
                <ToggleGroupItem
                  key={item.id}
                  value={item.id}
                  className="font-mono data-[state=on]:border-primary/70 data-[state=on]:bg-primary/15"
                >
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <ResolutionPicker
            aspect={aspect}
            megapixels={megapixels}
            disabled={readOnly || settingsLocked}
            onChange={setMegapixels}
          />

          <Field>
            <LabelWithHelp label="步数">
              第 1 段可选 16 / 20 / 25，默认 20。后续段沿用，不能单独改。
            </LabelWithHelp>
            <ToggleGroup
              type="single"
              value={targetIndex > 1 ? String(job.steps ?? 20) : steps}
              onValueChange={(value) => {
                if (value) setSteps(value)
              }}
              variant="outline"
              size="sm"
              className="flex-wrap"
              disabled={readOnly || targetIndex > 1}
            >
              {LONG_STEP_OPTIONS.map((item) => (
                <ToggleGroupItem
                  key={item}
                  value={String(item)}
                  className="font-mono tabular-nums data-[state=on]:border-primary/70 data-[state=on]:bg-primary/15"
                >
                  {item}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <LabelWithHelp htmlFor="long-seed" label="Seed">
              每段默认随机。接缝靠潜变量，不靠同一个编号。
            </LabelWithHelp>
            <div className="flex items-center gap-2">
              <Input
                id="long-seed"
                className="font-mono tabular-nums"
                inputMode="numeric"
                value={seed}
                onChange={(event) => setSeed(Number(event.target.value) || 0)}
                disabled={readOnly || randomize}
              />
              <div className="flex items-center gap-2 whitespace-nowrap text-sm">
                <Switch
                  checked={randomize}
                  onCheckedChange={setRandomize}
                  id="long-randomize"
                  disabled={readOnly}
                />
                <label htmlFor="long-randomize">随机</label>
              </div>
            </div>
          </Field>
        </FieldGroup>
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
          {retry
            ? `第 ${retry.index} 段需要重写。后面已排队的段先挂着，确认后会丢掉并排到队尾。`
            : busy
              ? "监视器看着当前段。再点生成会把下一段排到队尾，不必等这一段跑完。"
              : finalized
                ? "已定稿。撤销后仍从最后成功的一段接着写。"
                : "可以连续往队列里加段。有未完成的段时不能定稿。"}
        </p>
        <div className="flex flex-col gap-2">
          {finalized ? (
            <Button type="button" variant="outline" onClick={onReopen}>
              撤销定稿
            </Button>
          ) : (
            <>
              <Button
                type="button"
                size="lg"
                className="h-11 w-full"
                disabled={generateDisabled}
                onClick={() => {
                  if (needsSubmitConfirm) {
                    setRedoSubmitOpen(true)
                    return
                  }
                  void submitGenerate()
                }}
              >
                {submitting ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlayIcon data-icon="inline-start" />
                )}
                {submitting ? "提交中" : `生成第 ${targetIndex} 段`}
              </Button>
              {successCount > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={unfinished || submitting}
                  onClick={onFinalize}
                >
                  结束并定稿
                </Button>
              ) : null}
              {redoIndex && !retry ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setRedoIndex(null)
                    onPromptChange("")
                    setRandomize(true)
                    setSeed(randomSeed())
                    setAspect(job.aspect)
                    setMegapixels(job.megapixels ?? 0.98)
                    setSteps(String(job.steps ?? 20))
                  }}
                >
                  取消重写，改为写下一段
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <AlertDialog
        open={redoConfirmIndex !== null}
        onOpenChange={(open) => {
          if (!open) setRedoConfirmIndex(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {redoConfirmIndex ? `重写第 ${redoConfirmIndex} 段？` : "重写这一段？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {redoConfirmTail > 0 ? (
                <span className="flex flex-col gap-2">
                  <span>
                    将清掉 {formatSegmentIndexes(redoConfirmSegments.map((segment) => segment.index))}，共 {redoConfirmTail} 段。
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {segmentStatusCounts(redoConfirmSegments)}。潜变量不能接着用，确定后重新提交会排到队尾。
                  </span>
                </span>
              ) : (
                `将用新生成替换第 ${redoConfirmIndex ?? ""} 段。点确定后仍可改提示词，再点生成才会提交。`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (redoConfirmIndex) beginRedo(redoConfirmIndex)
              }}
            >
              确定重写
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={redoSubmitOpen} onOpenChange={setRedoSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`提交重写第 ${redoIndex ?? retry?.index ?? targetIndex} 段？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {laterCount > 0
                ? `提交后会清掉 ${formatSegmentIndexes(laterSegments(long, targetIndex).map((segment) => segment.index))}，共 ${laterCount} 段。这一段重新排到队尾，此操作不能从列表里撤销。`
                : "提交后会按当前提示词重新生成这一段，替换现有成片，并排到队尾。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setRedoSubmitOpen(false)
                void submitGenerate()
              }}
            >
              确定提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

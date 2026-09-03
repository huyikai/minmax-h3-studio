"use client"

import { useEffect, useState } from "react"
import { DownloadIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { isBusyJob, isLongJob, isWaitingJob, statusLabel } from "@/lib/job-view"
import {
  displayNodeTitle,
  monitorTimingItems,
  progressPercent,
} from "@/lib/job-timing"
import {
  activeLongSegment,
  canDispatchLongSegment,
  chainBreakSegment,
  impactedLongSegments,
  lastSuccessfulSegment,
  queuedLongSegments,
  retryableSegment,
  runningLongSegment,
  successfulSegments,
} from "@/lib/long-video"
import type { PublicJob } from "@/lib/types"
import { cn } from "@/lib/utils"

function MetaBits({
  items,
  className,
}: {
  items: string[]
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground",
        className
      )}
    >
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="flex items-center gap-2">
          {index > 0 ? (
            <span className="h-3 w-px bg-border" aria-hidden="true" />
          ) : null}
          {item}
        </span>
      ))}
    </span>
  )
}

function useTickingNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [enabled])
  return now
}

function longStripPhase(job: PublicJob) {
  if (isWaitingJob(job)) return "waiting" as const
  if (job.status === "queued") return "queued" as const
  if (job.status === "running") return "running" as const
  if (job.status === "error") return "error" as const
  if (job.status === "interrupted") return "interrupted" as const
  const retry = retryableSegment(job.long)
  if (retry?.status === "interrupted") return "interrupted" as const
  if (retry?.status === "error") return "error" as const
  return null
}

function ProgressBody({
  job,
  now,
  phase,
}: {
  job: PublicJob
  now: number
  phase: "waiting" | "queued" | "running"
}) {
  const percent = progressPercent(job.progress)
  const hasSteps = Boolean(job.progress?.max)
  const nodeLabel = displayNodeTitle(job.progress?.nodeTitle)
  const headline = hasSteps
    ? nodeLabel
    : nodeLabel === "正在执行"
      ? "模型加载或排队中"
      : nodeLabel

  if (phase === "waiting") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">已在 Studio 队列</p>
        <MetaBits items={monitorTimingItems(job, "waiting", now)} />
        <p className="text-xs text-muted-foreground">
          等 ComfyUI 空闲后会按顺序开跑。参数已冻结，不能改。
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Spinner className="size-4 text-primary" />
        <p className="text-sm text-muted-foreground">{headline}</p>
        {percent != null ? (
          <p className="font-mono text-sm tabular-nums tracking-tight">{percent}%</p>
        ) : null}
        {hasSteps ? (
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            {job.progress?.value ?? 0} / {job.progress?.max}
          </p>
        ) : nodeLabel !== "正在执行" ? (
          <p className="text-xs text-muted-foreground">模型加载或排队中</p>
        ) : null}
      </div>
      <Progress value={percent} className="h-2 w-full" />
      <MetaBits
        items={monitorTimingItems(
          job,
          phase === "queued" ? "queued" : "running",
          now
        )}
      />
    </div>
  )
}

function LongQueueSummary({
  job,
  onSelectSegment,
}: {
  job: PublicJob
  onSelectSegment?: (index: number) => void
}) {
  const running = runningLongSegment(job.long)
  const broken = chainBreakSegment(job.long)
  const queued = queuedLongSegments(job.long)
  const impacted = impactedLongSegments(job.long)
  const queueLabel = queued
    .slice(0, 4)
    .map((segment) => {
      const status = segment.status === "queued"
        ? "排队中"
        : canDispatchLongSegment(job.long, segment.index)
          ? "排队中"
          : "等待前段"
      return `${segment.index}段 ${status}`
    })
  const more = Math.max(0, queued.length - queueLabel.length)

  function segmentButton(index: number, label: string) {
    if (!onSelectSegment) return <span key={index}>{label}</span>
    return (
      <button
        key={index}
        type="button"
        className="rounded px-1 underline-offset-2 hover:bg-muted hover:underline"
        onClick={() => onSelectSegment(index)}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1 border-t px-4 py-2.5 text-xs" aria-live="polite">
      {running ? (
        <p className="font-medium text-primary">当前生成：第 {running.index} 段</p>
      ) : broken ? (
        <p className="font-medium text-destructive">
          当前无生成 · 第 {broken.index} 段{broken.status === "error" ? "失败" : "已中断"}
          {impacted.length > 0 ? ` · 后续 ${impacted.length} 段等待前段` : ""}
        </p>
      ) : queued.length > 0 ? (
        <p className="font-medium text-muted-foreground">当前无生成 · 等待第 {queued[0].index} 段处理</p>
      ) : null}
      {queued.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1 text-muted-foreground">
          <span>队列中：</span>
          {queueLabel.map((label, index) => segmentButton(queued[index].index, label))}
          {more > 0 ? <span>还有 {more} 段</span> : null}
        </p>
      ) : null}
    </div>
  )
}

function FailureBody({
  job,
  now,
  interrupted,
}: {
  job: PublicJob
  now: number
  interrupted: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <Alert variant={interrupted ? "default" : "destructive"}>
        <AlertTitle>{interrupted ? "已中断" : "生成失败"}</AlertTitle>
        <AlertDescription>
          {job.error ?? (interrupted ? "这次生成已停下。" : "生成失败")}
        </AlertDescription>
      </Alert>
      <MetaBits items={monitorTimingItems(job, "failed", now)} />
    </div>
  )
}

export type MonitorMode = "current" | "stitched"

export function MonitorPanel({
  job,
  busy,
  aspect,
  duration,
  mode,
  onModeChange,
  pastSegmentIndex,
  onPastSegmentIndexChange,
  onSelectSegment,
  onInterrupt,
  onRetryStitch,
  emptyHint,
}: {
  job: PublicJob | null
  busy: boolean
  aspect: string
  duration: string
  mode: MonitorMode
  onModeChange: (mode: MonitorMode) => void
  pastSegmentIndex?: number | null
  onPastSegmentIndexChange?: (index: number) => void
  onSelectSegment?: (index: number) => void
  onInterrupt?: () => void
  onRetryStitch?: () => void
  emptyHint: string
}) {
  const ticking = Boolean(job && (busy || isWaitingJob(job)))
  const now = useTickingNow(ticking)
  const long = Boolean(job && isLongJob(job))
  const successes = job ? successfulSegments(job.long) : []
  const showStitchTab = long && successes.length >= 2
  const last = job ? lastSuccessfulSegment(job.long) : undefined
  const active = job ? activeLongSegment(job.long) : undefined
  const retryable = job ? retryableSegment(job.long) : undefined
  const selectedPast =
    successes.find((item) => item.index === pastSegmentIndex) ?? last
  const showStitched = Boolean(showStitchTab && mode === "stitched")
  const currentUrl = long
    ? selectedPast?.outputUrl ?? job?.previewUrl
    : job?.outputUrl
  const videoUrl = showStitched ? job?.stitchedUrl : currentUrl
  const stripPhase = long && job ? longStripPhase(job) : null
  const showSuccessVideo = long
    ? Boolean(videoUrl)
    : Boolean(videoUrl) && !busy && job?.status !== "error"
  const showError = !long && job?.status === "error" && !busy && !showStitched
  const showInterrupted =
    !long &&
    job?.status === "interrupted" &&
    !busy &&
    !showStitched &&
    !showSuccessVideo
  const percent = busy ? progressPercent(job?.progress) : undefined
  const hasSteps = Boolean(job?.progress?.max)
  const nodeLabel = displayNodeTitle(job?.progress?.nodeTitle)
  const headline = hasSteps
    ? nodeLabel
    : nodeLabel === "正在执行"
      ? "模型加载或排队中"
      : nodeLabel
  const segmentBit = active
    ? `第 ${active.index} 段`
    : retryable
      ? `第 ${retryable.index} 段`
      : selectedPast
        ? `第 ${selectedPast.index} 段`
        : last
          ? `第 ${last.index} 段`
          : "还没有段"
  const headerTiming =
    job && !long && !busy && retryable
      ? monitorTimingItems(job, "failed", now).filter(
          (item) => item.startsWith("本段") || item.startsWith("累计")
        )
      : []

  return (
    <div className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-sm font-medium">成片</span>
          {showStitchTab ? (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="成片视图"
              value={mode === "stitched" ? "stitched" : "current"}
              onValueChange={(value) => {
                if (!value) return
                onModeChange(value as MonitorMode)
              }}
            >
              <ToggleGroupItem value="current">过往段</ToggleGroupItem>
              <ToggleGroupItem value="stitched">已拼接</ToggleGroupItem>
            </ToggleGroup>
          ) : long && successes.length > 0 ? (
            <span className="text-xs text-muted-foreground">过往段</span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {job ? (
            <MetaBits
              items={
                long
                  ? [statusLabel(job), segmentBit, job.aspect, ...headerTiming]
                  : [
                      statusLabel(job),
                      `${job.duration}s`,
                      job.aspect,
                      `seed ${job.seed}`,
                    ]
              }
            />
          ) : (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {aspect} {duration}s
            </span>
          )}
          {job && isBusyJob(job) && onInterrupt ? (
            <Button type="button" size="sm" variant="outline" onClick={onInterrupt}>
              <SquareIcon data-icon="inline-start" />
              中断
            </Button>
          ) : null}
        </div>
      </div>
      {stripPhase && job ? (
        <div className="border-b px-4 py-3" aria-busy={busy} aria-live="polite">
          {stripPhase === "error" || stripPhase === "interrupted" ? (
            <FailureBody
              job={job}
              now={now}
              interrupted={stripPhase === "interrupted"}
            />
          ) : (
            <ProgressBody job={job} now={now} phase={stripPhase} />
          )}
        </div>
      ) : null}
      {long && job ? <LongQueueSummary job={job} onSelectSegment={onSelectSegment} /> : null}
      {!showStitched && successes.length > 1 ? (
        <div className="flex overflow-x-auto border-b px-4 py-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="过往段"
            className="max-w-full"
            value={selectedPast ? String(selectedPast.index) : ""}
            onValueChange={(value) => {
              if (!value) return
              onPastSegmentIndexChange?.(Number(value))
            }}
          >
            {successes.map((item) => (
              <ToggleGroupItem key={item.index} value={String(item.index)}>
                第 {item.index} 段
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}
      <div
        className={cn(
          "relative flex min-h-64 flex-1 items-center justify-center studio-letterbox",
          !long && busy && "studio-scan"
        )}
        aria-busy={!long && busy}
        aria-live="polite"
      >
        {showStitched && job?.long?.stitchError && !job.stitchedUrl ? (
          <div className="w-full max-w-lg p-6">
            <Alert variant="destructive">
              <AlertTitle>还没有拼好</AlertTitle>
              <AlertDescription>{job.long.stitchError}</AlertDescription>
            </Alert>
            {onRetryStitch ? (
              <Button
                type="button"
                size="sm"
                className="mt-3"
                variant="outline"
                onClick={onRetryStitch}
              >
                重试拼接
              </Button>
            ) : null}
          </div>
        ) : showSuccessVideo && videoUrl ? (
          <video
            key={videoUrl}
            className="max-h-[min(32rem,55dvh)] w-full object-contain"
            src={videoUrl}
            controls
            autoPlay
          />
        ) : !long && busy && job ? (
          <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
            <Spinner className="size-8 text-primary" />
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm text-muted-foreground">{headline}</p>
              {percent != null ? (
                <p className="font-mono text-2xl tabular-nums tracking-tight">
                  {percent}%
                </p>
              ) : null}
            </div>
            <Progress value={percent} className="h-2 w-full" />
            <div className="flex flex-col items-center gap-2">
              {hasSteps ? (
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {job.progress?.value ?? 0} / {job.progress?.max}
                </p>
              ) : nodeLabel !== "正在执行" ? (
                <p className="text-xs text-muted-foreground">模型加载或排队中</p>
              ) : null}
              <MetaBits
                className="justify-center"
                items={monitorTimingItems(
                  job,
                  job.status === "queued" ? "queued" : "running",
                  now
                )}
              />
            </div>
          </div>
        ) : !long && job && isWaitingJob(job) ? (
          <div className="flex w-full max-w-xl flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm font-medium">已在 Studio 队列</p>
            <MetaBits
              className="justify-center"
              items={monitorTimingItems(job, "waiting", now)}
            />
            <p className="max-w-[36ch] text-sm leading-relaxed text-muted-foreground text-pretty">
              等 ComfyUI 空闲后会按顺序开跑。参数已冻结，不能改。
            </p>
          </div>
        ) : showError ? (
          <div className="flex w-full max-w-lg flex-col gap-3 p-6">
            <Alert variant="destructive">
              <AlertTitle>生成失败</AlertTitle>
              <AlertDescription>{job?.error}</AlertDescription>
            </Alert>
            {job ? (
              <MetaBits items={monitorTimingItems(job, "failed", now)} />
            ) : null}
          </div>
        ) : showInterrupted ? (
          <div className="flex w-full max-w-lg flex-col gap-3 p-6">
            <Alert>
              <AlertTitle>已中断</AlertTitle>
              <AlertDescription>{job?.error ?? "这次生成已停下。"}</AlertDescription>
            </Alert>
            {job ? (
              <MetaBits items={monitorTimingItems(job, "failed", now)} />
            ) : null}
          </div>
        ) : (
          <div
            className="flex w-full max-w-xl flex-col items-center justify-center gap-3 border border-dashed border-border/70 p-8 text-center"
            style={{ aspectRatio: aspect.replace(":", " / ") }}
          >
            <p className="text-sm font-medium">还没有成片</p>
            <p className="max-w-[36ch] text-sm leading-relaxed text-muted-foreground text-pretty">
              {emptyHint}
            </p>
          </div>
        )}
      </div>
      {job ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {job.workflowFile}
          </span>
          <div className="ml-auto flex gap-2">
            {videoUrl ? (
              <Button size="sm" variant="outline" asChild>
                <a href={videoUrl} download>
                  <DownloadIcon data-icon="inline-start" />
                  {showStitched ? "下载拼接" : "下载成片"}
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" asChild>
              <a href={job.workflowUrl} download>
                本次 JSON
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

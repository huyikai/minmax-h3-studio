"use client"

import { DownloadIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isBusyJob, isLongJob, isWaitingJob, statusLabel } from "@/lib/job-view"
import {
  lastSuccessfulSegment,
  successfulSegments,
} from "@/lib/long-video"
import type { PublicJob } from "@/lib/types"
import { cn } from "@/lib/utils"

function MetaBits({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
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

export type MonitorMode = "current" | "stitched"

export function MonitorPanel({
  job,
  busy,
  progressPercent,
  aspect,
  duration,
  mode,
  onModeChange,
  onInterrupt,
  onRetryStitch,
  emptyHint,
}: {
  job: PublicJob | null
  busy: boolean
  progressPercent: number
  aspect: string
  duration: string
  mode: MonitorMode
  onModeChange: (mode: MonitorMode) => void
  onInterrupt?: () => void
  onRetryStitch?: () => void
  emptyHint: string
}) {
  const long = Boolean(job && isLongJob(job))
  const canStitch = Boolean(job && successfulSegments(job.long).length > 0)
  const last = job ? lastSuccessfulSegment(job.long) : undefined
  const currentUrl = long ? last?.outputUrl ?? job?.previewUrl : job?.outputUrl
  const showStitched = long && mode === "stitched"
  const videoUrl = showStitched ? job?.stitchedUrl : currentUrl
  const showSuccessVideo = Boolean(videoUrl) && !busy && job?.status !== "error"
  const showError = job?.status === "error" && !busy && !showStitched

  return (
    <div className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-sm font-medium">成片</span>
          {long && canStitch ? (
            <Tabs
              value={mode}
              onValueChange={(value) => onModeChange(value as MonitorMode)}
            >
              <TabsList variant="line">
                <TabsTrigger value="current">当前段</TabsTrigger>
                <TabsTrigger value="stitched">已拼接</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {job ? (
            <MetaBits
              items={
                long
                  ? [
                      statusLabel(job),
                      last ? `第 ${last.index} 段` : "还没有段",
                      job.aspect,
                    ]
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
      <div
        className={cn(
          "relative flex min-h-64 flex-1 items-center justify-center studio-letterbox",
          busy && "studio-scan"
        )}
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
        ) : busy ? (
          <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-4 p-8">
            <p className="text-sm text-muted-foreground">
              {job?.progress?.nodeTitle ||
                (job?.progress?.node
                  ? `节点 ${job.progress.node}`
                  : "已提交，等待 ComfyUI")}
            </p>
            <Progress value={progressPercent} className="w-full" />
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {job?.progress?.max
                ? `${job.progress.value} / ${job.progress.max}`
                : "排队或加载模型中"}
            </p>
          </div>
        ) : job && isWaitingJob(job) ? (
          <div className="flex w-full max-w-xl flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm font-medium">已在 Studio 队列</p>
            <p className="max-w-[36ch] text-sm leading-relaxed text-muted-foreground text-pretty">
              等 ComfyUI 空闲后会按顺序开跑。参数已冻结，不能改。
            </p>
          </div>
        ) : showError ? (
          <div className="w-full max-w-lg p-6">
            <Alert variant="destructive">
              <AlertTitle>生成失败</AlertTitle>
              <AlertDescription>{job?.error}</AlertDescription>
            </Alert>
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

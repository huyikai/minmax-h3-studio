"use client"

import { useEffect, useMemo, useState } from "react"
import { PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { ASPECT_PRESETS, DURATION_OPTIONS } from "@/lib/types"
import type { PublicJob } from "@/lib/types"
import { isBusyJob } from "@/lib/job-view"
import {
  lastSuccessfulSegment,
  mergeLockIntoPrompt,
  nextClipIndex,
  retryableSegment,
  successfulSegments,
  waitingSegment,
} from "@/lib/long-video"
import { cn } from "@/lib/utils"

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000)
}

function segmentStatusLabel(status: string) {
  switch (status) {
    case "waiting":
      return "等待"
    case "queued":
      return "排队中"
    case "running":
      return "生成中"
    case "success":
      return "完成"
    case "error":
      return "失败"
    case "interrupted":
      return "已中断"
    case "voided":
      return "已作废"
    default:
      return status
  }
}

export type LongGeneratePayload = {
  prompt: string
  duration: number
  aspect: string
  seed: number
  lockPrompt: string
  redoIndex?: number
}

export function LongWorkspace({
  job,
  submitting,
  prompt,
  textareaRef,
  onPromptChange,
  onPromptFocus,
  onGenerate,
  onFinalize,
  onReopen,
}: {
  job: PublicJob
  submitting: boolean
  prompt: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onPromptChange: (value: string | ((prev: string) => string)) => void
  onPromptFocus?: () => void
  onGenerate: (payload: LongGeneratePayload) => void
  onFinalize: () => void
  onReopen: () => void
}) {
  const long = job.long
  const busy = isBusyJob(job)
  const queuedNext = Boolean(waitingSegment(long))
  const finalized = Boolean(long?.finalized)
  const aspectLocked = Boolean(long?.aspectLocked)
  const retry = retryableSegment(long)
  const nextIndex = nextClipIndex(long)
  const successCount = successfulSegments(long).length

  const [lockPrompt, setLockPrompt] = useState(long?.lockPrompt ?? "")
  const [duration, setDuration] = useState("5")
  const [aspect, setAspect] = useState(job.aspect)
  const [seed, setSeed] = useState(randomSeed())
  const [randomize, setRandomize] = useState(true)
  const [redoIndex, setRedoIndex] = useState<number | null>(null)

  useEffect(() => {
    setLockPrompt(job.long?.lockPrompt ?? "")
    setAspect(job.aspect)
  }, [job.id, job.long?.lockPrompt, job.aspect])

  useEffect(() => {
    onPromptChange("")
    setDuration("5")
    setRandomize(true)
    setSeed(randomSeed())
    setRedoIndex(null)
  }, [job.id, onPromptChange])

  useEffect(() => {
    if (!retry) return
    setRedoIndex(null)
    onPromptChange(retry.prompt)
    setDuration(String(retry.duration))
    setSeed(retry.seed)
    setRandomize(false)
  }, [job.id, retry?.index, retry?.status, retry?.prompt, onPromptChange])

  const lastSuccess = lastSuccessfulSegment(long)
  useEffect(() => {
    if (!lastSuccess || retry || queuedNext || busy || finalized) return
    const completedPrompt = lastSuccess.prompt
    onPromptChange((prev) =>
      prev.trim() === completedPrompt.trim() ? "" : prev
    )
  }, [lastSuccess?.index, lastSuccess?.status, lastSuccess?.prompt, retry?.index, queuedNext, busy, finalized, onPromptChange])

  const submittedPreview = useMemo(
    () => mergeLockIntoPrompt(lockPrompt, prompt),
    [lockPrompt, prompt]
  )
  const targetIndex = redoIndex ?? nextIndex
  const readOnly = queuedNext || finalized
  const generateDisabled = readOnly || submitting || !prompt.trim()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <FieldGroup>
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
            <LabelWithHelp label="已生成的段">
              不能跳段。重做某一段会作废它后面的段，潜变量文件可能还在，但不进这条链。
            </LabelWithHelp>
            <ul className="flex flex-col gap-1.5">
              {(long?.segments ?? []).length === 0 ? (
                <li className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  还没有段。下面写第 1 段。
                </li>
              ) : (
                (long?.segments ?? []).map((segment) => (
                  <li
                    key={segment.index}
                    className={cn(
                      "flex items-start justify-between gap-2 rounded-md border px-3 py-2",
                      segment.status === "voided" && "opacity-50"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        第 {segment.index} 段 · {segment.duration}s · seed {segment.seed}
                      </span>
                      <span className="mt-0.5 block text-xs">
                        {segmentStatusLabel(segment.status)}
                      </span>
                      <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {segment.prompt || "（无提示词）"}
                      </span>
                    </span>
                    {segment.status === "success" && !busy && !queuedNext && !finalized ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRedoIndex(segment.index)
                          onPromptChange(segment.prompt)
                          setDuration(String(segment.duration))
                          setSeed(segment.seed)
                          setRandomize(false)
                        }}
                      >
                        重做
                      </Button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
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
                ? `将重做第 ${redoIndex} 段，并作废后面的段。`
                : retry
                  ? `重提第 ${retry.index} 段。`
                  : `生成第 ${targetIndex} 段。不能跳段。`}
            </FieldDescription>
          </Field>

          {prompt.trim() && lockPrompt.trim() ? (
            <Field>
              <LabelWithHelp label="实际提交">
                公共锁定会写在 integrated_multimodal_description 开头。环境音和配乐不动。
              </LabelWithHelp>
              <pre className="max-h-40 overflow-auto rounded-md border bg-monitor/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
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
              第一段成功后锁定。整条链必须同一分辨率，潜变量不能缩放。
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
              disabled={readOnly || aspectLocked}
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
          {queuedNext
            ? "下一段已在队列里。要改词请先从队列撤下。"
            : busy
              ? "监视器看着这一段。再点生成会把下一段排到队列后面。"
              : finalized
                ? "已定稿。撤销后仍从最后成功的一段接着写。"
                : "官方文生、20 步、不用 Turbo。生成后是待续，点定稿才算完成。"}
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
                  if (redoIndex) {
                    const tail = (long?.segments ?? []).some(
                      (item) => item.index > redoIndex && item.status === "success"
                    )
                    if (tail) {
                      const ok = window.confirm(
                        `重做第 ${redoIndex} 段会作废后面所有段。确定吗？`
                      )
                      if (!ok) return
                    }
                  }
                  const nextSeed = randomize ? randomSeed() : seed
                  if (randomize) setSeed(nextSeed)
                  onGenerate({
                    prompt,
                    duration: Number(duration),
                    aspect,
                    seed: nextSeed,
                    lockPrompt,
                    redoIndex: redoIndex ?? undefined,
                  })
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
                  disabled={busy || queuedNext || submitting}
                  onClick={onFinalize}
                >
                  结束并定稿
                </Button>
              ) : null}
              {redoIndex ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setRedoIndex(null)
                    onPromptChange("")
                    setRandomize(true)
                    setSeed(randomSeed())
                  }}
                >
                  取消重做，改为写下一段
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

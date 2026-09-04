"use client"

import { useMemo, useState } from "react"
import { CheckIcon, EllipsisVerticalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import type { PublicJob } from "@/lib/types"
import {
  isBusyJob,
  jobListFailure,
  jobListMeta,
  jobListPrompt,
  jobPreviewUrl,
  statusLabel,
} from "@/lib/job-view"

export { isBusyJob, statusLabel }

type TaskListProps = {
  jobs: PublicJob[]
  currentId?: string
  emptyHint?: string
  onSelect: (job: PublicJob) => void
  onDelete: (job: PublicJob) => void
  onDeleteMany: (jobs: PublicJob[]) => void
  muted?: boolean
}

export function TaskList({
  jobs,
  currentId,
  emptyHint = "点上方新建短片或新建长视频。",
  onSelect,
  onDelete,
  onDeleteMany,
  muted = false,
}: TaskListProps) {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const deletable = useMemo(
    () => jobs.filter((job) => !isBusyJob(job)),
    [jobs]
  )
  const selectedJobs = jobs.filter((job) => selected.has(job.id) && !isBusyJob(job))

  function exitSelect() {
    setSelecting(false)
    setSelected(new Set())
  }

  function toggle(id: string, allowed: boolean) {
    if (!allowed) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllDeletable() {
    setSelected(new Set(deletable.map((job) => job.id)))
  }

  if (jobs.length === 0) {
    return (
      <Empty className="min-h-0 flex-1 rounded-xl border bg-card/40 py-10">
        <EmptyHeader>
          <EmptyTitle>还没有任务</EmptyTitle>
          <EmptyDescription>{emptyHint}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2 bg-background py-0.5">
        {selecting ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={exitSelect}>
              取消
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={selectAllDeletable}
                disabled={deletable.length === 0}
              >
                全选
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={selectedJobs.length === 0}
                onClick={() => onDeleteMany(selectedJobs)}
              >
                删除 {selectedJobs.length || ""}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{jobs.length} 条任务</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelecting(true)}
            >
              选择
            </Button>
          </>
        )}
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-1">
        {jobs.map((job) => {
          const isSelected = selected.has(job.id)
          const current = currentId === job.id
          const busy = isBusyJob(job)
          const preview = jobPreviewUrl(job)
          return (
            <li key={job.id}>
              <div
                className={cn(
                  "flex gap-1 rounded-lg border bg-card p-1.5 transition-colors",
                  current && !selecting && "border-primary/70 bg-primary/10",
                  selecting && isSelected && "border-primary/70 bg-primary/10"
                )}
              >
                {selecting ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={busy ? "进行中，不能删除" : "选中任务"}
                    disabled={busy}
                    className={cn(
                      "mt-1 ml-1 flex size-5 shrink-0 items-center justify-center rounded-sm border",
                      busy && "cursor-not-allowed opacity-40",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background"
                    )}
                    onClick={() => toggle(job.id, !busy)}
                  >
                    {isSelected ? <CheckIcon className="size-3" /> : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  className="flex min-w-0 flex-1 gap-2 rounded-md p-1 text-left hover:bg-muted/50"
                  onClick={() => {
                    if (selecting) toggle(job.id, !busy)
                    else onSelect(job)
                  }}
                >
                  <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md studio-letterbox">
                    {preview ? (
                      <video
                        src={preview}
                        muted={muted}
                        playsInline
                        preload="metadata"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center font-mono text-[10px] text-muted-foreground">
                        {statusLabel(job)}
                      </span>
                    )}
                  </div>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs font-medium">{statusLabel(job)}</span>
                    <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {jobListPrompt(job)}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {jobListMeta(job).join(" · ")}
                    </span>
                    {jobListFailure(job) ? (
                      <span className="line-clamp-2 font-mono text-[11px] leading-relaxed text-destructive">
                        {jobListFailure(job)}
                      </span>
                    ) : null}
                  </span>
                </button>
                {selecting ? null : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="mt-0.5 shrink-0"
                        aria-label="任务菜单"
                      >
                        <EllipsisVerticalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto min-w-36">
                      <DropdownMenuItem onSelect={() => onSelect(job)}>
                        打开
                      </DropdownMenuItem>
                      {busy ? null : (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onDelete(job)}
                        >
                          删除
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

"use client"

import { EllipsisVerticalIcon } from "lucide-react"
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

export function isBusyJob(job: PublicJob) {
  return job.status === "queued" || job.status === "running"
}

export function statusLabel(job: PublicJob) {
  switch (job.status) {
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
  }
}

type TaskListProps = {
  jobs: PublicJob[]
  currentId?: string
  onSelect: (job: PublicJob) => void
  onOpenDetail: (job: PublicJob) => void
  onDelete: (job: PublicJob) => void
}

export function TaskList({
  jobs,
  currentId,
  onSelect,
  onOpenDetail,
  onDelete,
}: TaskListProps) {
  if (jobs.length === 0) {
    return (
      <Empty className="rounded-xl border bg-card/40 py-10">
        <EmptyHeader>
          <EmptyTitle>还没有任务</EmptyTitle>
          <EmptyDescription>点上方新建。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {jobs.map((job) => {
        const selected = currentId === job.id
        const busy = isBusyJob(job)
        return (
          <li key={job.id}>
            <div
              className={cn(
                "flex gap-1 rounded-lg border bg-card p-1.5 transition-colors",
                selected && "border-primary/70 bg-primary/10"
              )}
            >
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                className="flex min-w-0 flex-1 gap-2 rounded-md p-1 text-left hover:bg-muted/50"
                onClick={() => onSelect(job)}
              >
                <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md studio-letterbox">
                  {job.outputUrl ? (
                    <video
                      src={job.outputUrl}
                      muted
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
                    {job.prompt || "（无提示词）"}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {job.duration}s · {job.aspect}
                  </span>
                </span>
              </button>
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
                  <DropdownMenuItem onSelect={() => onOpenDetail(job)}>
                    任务详情
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
            </div>
          </li>
        )
      })}
    </ul>
  )
}

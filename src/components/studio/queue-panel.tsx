"use client"

import { ListOrderedIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PublicJob, StudioQueueSnapshot } from "@/lib/types"
import { cn } from "@/lib/utils"

export function QueuePanel({
  queue,
  jobs,
  onOpen,
  onResume,
  onWithdraw,
}: {
  queue: StudioQueueSnapshot
  jobs: PublicJob[]
  onOpen: (job: PublicJob) => void
  onResume: () => void
  onWithdraw: (job: PublicJob) => void
}) {
  if (queue.items.length === 0) return null

  return (
    <section className="max-h-[min(12rem,30vh)] shrink-0 overflow-y-auto overscroll-contain rounded-xl border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListOrderedIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">
            {queue.paused ? "队列已暂停" : "队列"}
          </h2>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {queue.remaining} 条等待
          </span>
        </div>
        {queue.paused && queue.remaining > 0 ? (
          <Button type="button" size="sm" onClick={onResume}>
            继续队列（{queue.remaining}）
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1.5">
        {queue.items.map((item, index) => {
          const job = jobs.find((row) => row.id === item.jobId)
          const running = item.state === "running"
          return (
            <li key={`${item.jobId}-${item.segmentIndex ?? "job"}`}>
              <div
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-2.5 py-2",
                  running && "border-primary/70 bg-primary/10"
                )}
              >
                <span className="mt-0.5 w-5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    if (job) onOpen(job)
                  }}
                >
                  <span className="block text-xs font-medium">
                    {running ? "正在生成" : "等待"} · {item.label}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {item.prompt}
                  </span>
                </button>
                {running ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (job) onWithdraw(job)
                    }}
                  >
                    {item.kind === "long" ? "撤下" : "删除"}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

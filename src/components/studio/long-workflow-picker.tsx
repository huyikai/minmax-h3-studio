"use client"

import { LONG_WORKFLOW_GROUPS, type WorkflowListItem } from "@/lib/default-workflows"
import { longWorkflowDisableReason, type LongWorkflowInputFlags } from "@/lib/long-video"
import { cn } from "@/lib/utils"

export function annotateLongWorkflows(
  workflows: WorkflowListItem[],
  input: LongWorkflowInputFlags
) {
  return workflows
    .filter((item) => item.family === "long")
    .map((item) => {
      const reason = longWorkflowDisableReason(item.name, input)
      return { ...item, disabled: Boolean(reason), reason }
    })
}

export function LongWorkflowPicker({
  workflows,
  selected,
  input,
  locked,
  onChange,
}: {
  workflows: WorkflowListItem[]
  selected?: string
  input: LongWorkflowInputFlags
  locked?: boolean
  onChange: (name: string) => void
}) {
  const items = annotateLongWorkflows(workflows, input)
  return (
    <div className="flex flex-col gap-3">
      {LONG_WORKFLOW_GROUPS.map((group) => {
        const groupItems = items.filter(
          (item) => item.longCapabilities?.kind === group.kind
        )
        if (groupItems.length === 0) return null
        return (
          <div key={group.kind} className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
            {groupItems.map((item) => {
              const disabled = locked || item.disabled
              const selectedItem = selected === item.name
              return (
                <button
                  key={item.name}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(item.name)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    selectedItem
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/50",
                    disabled && "cursor-not-allowed opacity-60"
                  )}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.reason ?? item.description}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无长视频工作流。</p>
      ) : null}
    </div>
  )
}

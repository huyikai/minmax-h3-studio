"use client"

import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  DownloadIcon,
  FolderOpenIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type {
  FieldMapping,
  MappingOverrides,
  WorkflowMapping,
} from "@/lib/types"
import type { WorkflowBundle } from "@/components/studio/types"

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  port: number
  comfyUrl: string
  connected: boolean
  workflowName: string
  workflows: string[]
  bundle: WorkflowBundle | null
  onPortChange: (port: number) => Promise<void>
  onImported: (name: string) => Promise<void>
  onDeleted: (name: string) => Promise<void>
  onMappingSaved: (bundle: WorkflowBundle) => void
}

const ROLES: Array<{
  key: keyof Pick<
    WorkflowMapping,
    "prompt" | "firstFrame" | "duration" | "width" | "height" | "seed" | "steps" | "cfg"
  >
  label: string
}> = [
  { key: "prompt", label: "提示词" },
  { key: "firstFrame", label: "首帧" },
  { key: "duration", label: "时长" },
  { key: "width", label: "宽度" },
  { key: "height", label: "高度" },
  { key: "seed", label: "Seed" },
  { key: "steps", label: "步数" },
  { key: "cfg", label: "CFG" },
]

function mappingValue(mapping?: FieldMapping) {
  if (!mapping) return "none"
  return `${mapping.nodeId}::${mapping.input}`
}

function parseMapping(value: string): FieldMapping | null {
  if (!value || value === "none") return null
  const [nodeId, ...rest] = value.split("::")
  const input = rest.join("::")
  if (!nodeId || !input) return null
  return { nodeId, input }
}

export function SettingsDialog({
  open,
  onOpenChange,
  port,
  comfyUrl,
  connected,
  workflowName,
  workflows,
  bundle,
  onPortChange,
  onImported,
  onDeleted,
  onMappingSaved,
}: SettingsDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const portInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)

  const options = useMemo(() => {
    if (!bundle) return []
    return bundle.nodes.flatMap((node) =>
      node.inputs.map((input) => ({
        value: `${node.id}::${input}`,
        label: `#${node.id} ${node.title || node.classType} / ${input}`,
      }))
    )
  }, [bundle])

  async function savePort() {
    const next = Number(portInputRef.current?.value ?? port)
    if (!Number.isInteger(next) || next < 1 || next > 65535) {
      toast.error("端口必须是 1-65535 的整数")
      return
    }
    setSaving(true)
    try {
      await onPortChange(next)
      toast.success("已保存端口")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function importFile(file: File) {
    const form = new FormData()
    form.set("file", file)
    const response = await fetch("/api/workflows", { method: "POST", body: form })
    const json = (await response.json()) as WorkflowBundle & { error?: string }
    if (!response.ok) {
      throw new Error(json.error ?? "导入失败")
    }
    await onImported(json.name)
    toast.success(`已导入 ${json.name}`)
  }

  async function saveMapping() {
    if (!bundle) return
    const overrides: MappingOverrides = {
      durationUnit: bundle.mapping.durationUnit ?? "seconds",
    }
    for (const role of ROLES) {
      overrides[role.key] = bundle.mapping[role.key] ?? null
    }
    const response = await fetch(
      `/api/workflows/${encodeURIComponent(bundle.name)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      }
    )
    const json = (await response.json()) as WorkflowBundle & { error?: string }
    if (!response.ok) {
      toast.error(json.error ?? "保存映射失败")
      return
    }
    onMappingSaved(json)
    toast.success("已保存字段映射")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            Studio 只连本机 ComfyUI。工作流 JSON 放在仓库的 workflows/ 目录，或在这里上传。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="comfy-port">ComfyUI 端口</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="comfy-port"
                  ref={portInputRef}
                  key={port}
                  inputMode="numeric"
                  defaultValue={String(port)}
                />
                <Button type="button" variant="outline" onClick={() => void savePort()} disabled={saving}>
                  保存
                </Button>
              </div>
              <FieldDescription>
                默认 127.0.0.1:{port}。当前
                {connected ? "已连接" : "未连接"}。
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="outline">
                <a href={comfyUrl} target="_blank" rel="noreferrer">
                  <FolderOpenIcon data-icon="inline-start" />
                  打开 ComfyUI
                </a>
              </Button>
              <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                <span
                  className={cn("size-1.5 rounded-full", connected ? "lamp-live" : "lamp-off")}
                  aria-hidden="true"
                />
                {connected ? "已连接" : "未连接"}
              </span>
            </div>
          </FieldGroup>

          <FieldGroup className="border-t pt-5">
            <Field>
              <FieldLabel>工作流</FieldLabel>
              <FieldDescription>
                从 ComfyUI 菜单导出「API」格式 JSON。画布格式无法提交。
              </FieldDescription>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (file) {
                    void importFile(file).catch((error: unknown) => {
                      toast.error(
                        error instanceof Error ? error.message : "导入失败"
                      )
                    })
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                <UploadIcon data-icon="inline-start" />
                上传 API JSON
              </Button>
            </Field>
            {workflows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                还没有工作流。把 JSON 放到 workflows/ 或点上面的上传。
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {workflows.map((name) => (
                  <li
                    key={name}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate text-sm">
                      <span className="truncate">{name}</span>
                      {name === workflowName ? (
                        <span className="shrink-0 font-mono text-[11px] text-primary">
                          当前
                        </span>
                      ) : null}
                    </span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        void onDeleted(name).catch((error: unknown) => {
                          toast.error(
                            error instanceof Error ? error.message : "删除失败"
                          )
                        })
                      }}
                    >
                      <Trash2Icon />
                      <span className="sr-only">删除 {name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </FieldGroup>

          <FieldGroup className="border-t pt-5">
            <Field>
              <FieldLabel>字段映射</FieldLabel>
              <FieldDescription>
                默认按节点类型自动识别。认错时在这里改，只对当前这份 JSON 生效。
              </FieldDescription>
            </Field>
            {!bundle ? (
              <p className="text-sm text-muted-foreground">先导入或选择一份工作流。</p>
            ) : (
              <>
                <ScrollArea className="h-64 rounded-lg border">
                  <div className="flex flex-col gap-3 p-3">
                    {ROLES.map((role) => (
                      <Field key={role.key}>
                        <FieldLabel>{role.label}</FieldLabel>
                        <Select
                          value={mappingValue(bundle.mapping[role.key])}
                          onValueChange={(value) => {
                            const next = parseMapping(value)
                            onMappingSaved({
                              ...bundle,
                              mapping: {
                                ...bundle.mapping,
                                [role.key]: next ?? undefined,
                              },
                            })
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="未映射" />
                          </SelectTrigger>
                          <SelectContent position="popper" className="max-w-md">
                            <SelectGroup>
                              <SelectItem value="none">未映射</SelectItem>
                              {options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    ))}
                    <Field>
                      <FieldLabel>时长单位</FieldLabel>
                      <Select
                        value={bundle.mapping.durationUnit ?? "seconds"}
                        onValueChange={(value) => {
                          onMappingSaved({
                            ...bundle,
                            mapping: {
                              ...bundle.mapping,
                              durationUnit:
                                value === "frames" ? "frames" : "seconds",
                            },
                          })
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="seconds">秒（推荐）</SelectItem>
                            <SelectItem value="frames">帧数 length</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </ScrollArea>
                <Button type="button" variant="outline" onClick={() => void saveMapping()}>
                  保存映射
                </Button>
              </>
            )}
          </FieldGroup>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button asChild>
            <a href={comfyUrl} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />
              去 ComfyUI 导出工作流
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ClapperboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PlayIcon,
  RefreshCwIcon,
  Settings2Icon,
  SquareIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
import { LabelWithHelp } from "@/components/studio/field-help"
import { MediaSlots, type SlotFile } from "@/components/studio/media-slots"
import { PromptGuide } from "@/components/studio/prompt-guide"
import {
  ReferenceSlots,
  taggedRefs,
  type RefDraft,
} from "@/components/studio/reference-slots"
import { SettingsDialog } from "@/components/studio/settings-dialog"
import type { WorkflowBundle } from "@/components/studio/types"
import type { HealthStatus, LoraFormValue, MediaKind, PublicJob } from "@/lib/types"
import { ASPECT_PRESETS, DURATION_OPTIONS } from "@/lib/types"
import type { WorkflowListItem } from "@/lib/default-workflows"
import {
  REF_LIMITS,
  WORKFLOW_ALIASES,
  fileMatchesKind,
  refKindLabel,
  refSlotId,
} from "@/lib/refs"
import { resolveGuideMode } from "@/lib/prompt-guide"
import { cn } from "@/lib/utils"

const PROMPT_PLACEHOLDER = "聚焦后右侧显示写法"

function promptCoachHint(input: {
  hasFirstFrame: boolean
  hasLastFrame: boolean
  refTags: string[]
  dynamicRefs: boolean
  durationSeconds: number
}) {
  if (input.dynamicRefs) {
    if (input.refTags.length) {
      return `已加 ${input.refTags.join("、")}。点开写法按段插入；提示词建议英文。`
    }
    return "聚焦提示词查看写法。参考生先定义标签，再写画面。"
  }
  if (input.hasLastFrame) {
    return "首尾帧：先插入对齐句，再写两帧之间的过渡。聚焦后右侧可对照。"
  }
  if (input.hasFirstFrame) {
    return "图生：先插入对齐句，从首帧写运动。聚焦后右侧可对照。"
  }
  if (input.durationSeconds >= 13) {
    return "13-15 秒要有一条清楚的动作推进。聚焦提示词查看写法。"
  }
  return "聚焦提示词，右侧对照官方字段。正文建议英文。"
}

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000)
}

function statusLabel(job: PublicJob) {
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

function groupWorkflows(items: WorkflowListItem[]) {
  return {
    official: items.filter((item) => item.family === "official"),
    turbo: items.filter((item) => item.family === "turbo"),
    reference: items.filter((item) => item.family === "reference"),
    custom: items.filter((item) => item.family === "custom"),
  }
}

export function StudioApp() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [port, setPort] = useState(8188)
  const [comfyUrl, setComfyUrl] = useState("http://127.0.0.1:8188")
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [workflowName, setWorkflowName] = useState("")
  const [bundle, setBundle] = useState<WorkflowBundle | null>(null)
  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [current, setCurrent] = useState<PublicJob | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busyOpen, setBusyOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [prompt, setPrompt] = useState("")
  const [duration, setDuration] = useState("5")
  const [aspect, setAspect] = useState("16:9")
  const [seed, setSeed] = useState(1)
  const [randomize, setRandomize] = useState(true)
  const [steps, setSteps] = useState("")
  const [cfg, setCfg] = useState("")
  const [loras, setLoras] = useState<LoraFormValue[]>([])
  const [loraFiles, setLoraFiles] = useState<string[]>([])
  const [slotFiles, setSlotFiles] = useState<Record<string, SlotFile>>({})
  const [refDrafts, setRefDrafts] = useState<RefDraft[]>([])
  const [guideOpen, setGuideOpen] = useState(false)
  const [guidePinned, setGuidePinned] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const monitorRef = useRef<HTMLElement>(null)

  const connected = Boolean(health?.ok)
  const busy = Boolean(
    current && (current.status === "queued" || current.status === "running")
  )

  const loadHealth = useCallback(async () => {
    const response = await fetch("/api/health")
    const json = (await response.json()) as HealthStatus
    setHealth(json)
  }, [])

  const loadSettings = useCallback(async () => {
    const response = await fetch("/api/settings")
    const json = (await response.json()) as {
      comfyPort: number
      comfyUrl: string
      defaultWorkflow: string | null
    }
    setPort(json.comfyPort)
    setComfyUrl(json.comfyUrl)
    return json.defaultWorkflow
  }, [])

  const loadWorkflows = useCallback(async (preferred?: string | null, keep?: string) => {
    const response = await fetch("/api/workflows")
    const json = (await response.json()) as {
      files?: string[]
      workflows?: WorkflowListItem[]
    }
    const list =
      json.workflows ??
      (json.files ?? []).map((name) => ({
        name,
        label: name,
        description: "",
        family: "custom" as const,
        bundled: false,
        overridden: false,
      }))
    setWorkflows(list)
    const names = list.map((item) => item.name)
    const resolveName = (name?: string | null) => {
      if (!name) return name
      const aliased = WORKFLOW_ALIASES[name]
      if (aliased && names.includes(aliased)) return aliased
      return name
    }
    const keepName = resolveName(keep)
    const preferredName = resolveName(preferred)
    const next =
      keepName && names.includes(keepName)
        ? keepName
        : preferredName && names.includes(preferredName)
          ? preferredName
          : (names[0] ?? "")
    setWorkflowName(next)
    return { files: names, selected: next }
  }, [])

  const applyBundle = useCallback((next: WorkflowBundle) => {
    setBundle(next)
    setPrompt(next.values.prompt)
    setDuration(String(Math.round(next.values.duration) || 5))
    setAspect(next.values.aspect)
    setSeed(next.values.seed || randomSeed())
    setSteps(next.values.steps !== undefined ? String(next.values.steps) : "")
    setCfg(next.values.cfg !== undefined ? String(next.values.cfg) : "")
    setLoras(next.values.loras)
    setSlotFiles((previous) => {
      for (const item of Object.values(previous)) {
        URL.revokeObjectURL(item.preview)
      }
      return {}
    })
    setRefDrafts((previous) => {
      for (const item of previous) {
        URL.revokeObjectURL(item.preview)
      }
      return []
    })
  }, [])

  const loadBundle = useCallback(
    async (name: string) => {
      if (!name) {
        setBundle(null)
        return
      }
      const response = await fetch(`/api/workflows/${encodeURIComponent(name)}`)
      const json = (await response.json()) as WorkflowBundle & { error?: string }
      if (!response.ok) {
        toast.error(json.error ?? "读取工作流失败")
        return
      }
      applyBundle(json)
    },
    [applyBundle]
  )

  const listenJob = useCallback((jobId: string) => {
    eventSourceRef.current?.close()
    const source = new EventSource(`/api/jobs/${jobId}/events`)
    eventSourceRef.current = source
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { job: PublicJob | null }
      if (!payload.job) return
      setCurrent(payload.job)
      setJobs((list) => {
        const rest = list.filter((item) => item.id !== payload.job!.id)
        return [payload.job!, ...rest]
      })
      if (
        payload.job.status === "success" ||
        payload.job.status === "error" ||
        payload.job.status === "interrupted"
      ) {
        source.close()
        if (payload.job.status === "success") toast.success("成片已写入 Studio 输出目录")
        if (payload.job.status === "error") toast.error(payload.job.error ?? "生成失败")
      }
    }
    source.onerror = () => {
      source.close()
    }
  }, [])

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/jobs")
    const json = (await response.json()) as { jobs: PublicJob[] }
    setJobs(json.jobs)
    const active = json.jobs.find(
      (job) => job.status === "queued" || job.status === "running"
    )
    if (active) {
      setCurrent(active)
      listenJob(active.id)
    }
    return json.jobs
  }, [listenJob])

  useEffect(() => {
    void (async () => {
      const preferred = await loadSettings()
      const { selected } = await loadWorkflows(preferred)
      if (selected) await loadBundle(selected)
      await loadJobs()
      await loadHealth()
      const loraRes = await fetch("/api/loras")
      const loraJson = (await loraRes.json()) as { loras?: string[] }
      setLoraFiles(loraJson.loras ?? [])
    })()
    const timer = setInterval(() => {
      void loadHealth()
    }, 4000)
    return () => {
      clearInterval(timer)
      eventSourceRef.current?.close()
    }
  }, [loadBundle, loadHealth, loadJobs, loadSettings, loadWorkflows])

  function setSlotFile(slotId: string, file: File | null) {
    setSlotFiles((previous) => {
      const next = { ...previous }
      if (next[slotId]) URL.revokeObjectURL(next[slotId].preview)
      if (!file) {
        delete next[slotId]
        return next
      }
      next[slotId] = { file, preview: URL.createObjectURL(file) }
      return next
    })
  }

  function addRefFiles(kind: MediaKind, files: File[]) {
    setRefDrafts((previous) => {
      const used = previous.filter((item) => item.kind === kind).length
      const room = REF_LIMITS[kind] - used
      const accepted = files.filter((file) => fileMatchesKind(file, kind)).slice(0, Math.max(0, room))
      if (accepted.length < files.filter((file) => fileMatchesKind(file, kind)).length) {
        toast.error(`${refKindLabel(kind)}最多 ${REF_LIMITS[kind]} 个`)
      }
      return [
        ...previous,
        ...accepted.map((file) => ({
          id: crypto.randomUUID(),
          kind,
          file,
          preview: URL.createObjectURL(file),
        })),
      ]
    })
  }

  function removeRefDraft(id: string) {
    setRefDrafts((previous) => {
      const current = previous.find((item) => item.id === id)
      if (current) URL.revokeObjectURL(current.preview)
      return previous.filter((item) => item.id !== id)
    })
  }

  const progressPercent = useMemo(() => {
    if (!current?.progress?.max) return busy ? 8 : 0
    return Math.min(
      100,
      Math.round((current.progress.value / current.progress.max) * 100)
    )
  }, [busy, current])

  async function submit(ignoreBusy = false) {
    if (!workflowName) {
      toast.error("请先导入工作流")
      return
    }
    if (!prompt.trim()) {
      toast.error("请填写提示词")
      return
    }
    setSubmitting(true)
    try {
      const form = new FormData()
      form.set("workflowFile", workflowName)
      form.set("prompt", prompt)
      form.set("duration", duration)
      form.set("aspect", aspect)
      form.set("seed", String(randomize ? randomSeed() : seed))
      form.set("loras", JSON.stringify(loras))
      form.set("ignoreBusy", ignoreBusy ? "true" : "false")
      if (steps && bundle?.mapping.steps) form.set("steps", steps)
      if (cfg && bundle?.mapping.cfg) form.set("cfg", cfg)
      for (const [slotId, item] of Object.entries(slotFiles)) {
        form.set(`media:${slotId}`, item.file)
      }
      if (bundle?.mapping.dynamicRefs) {
        for (const item of taggedRefs(refDrafts)) {
          form.set(`media:${refSlotId(item.kind, item.index)}`, item.file)
        }
      }
      if (randomize) setSeed(Number(form.get("seed")))

      const response = await fetch("/api/jobs", { method: "POST", body: form })
      const json = (await response.json()) as {
        job?: PublicJob
        error?: string
        code?: string
      }
      if (response.status === 409 && json.code === "comfy_busy") {
        setBusyOpen(true)
        return
      }
      if (!response.ok || !json.job) {
        toast.error(json.error ?? "提交失败")
        if (json.job) {
          setCurrent(json.job)
          setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
        }
        return
      }
      setCurrent(json.job)
      setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
      listenJob(json.job.id)
    } finally {
      setSubmitting(false)
    }
  }

  function fillFromJob(job: PublicJob) {
    setCurrent(job)
    setPrompt(job.prompt)
    setDuration(String(job.duration))
    setAspect(job.aspect)
    setSeed(job.seed)
    setRandomize(false)
    setSteps(job.steps !== undefined ? String(job.steps) : "")
    setCfg(job.cfg !== undefined ? String(job.cfg) : "")
    setLoras(job.loras)
    if (job.workflowFile) {
      setWorkflowName(WORKFLOW_ALIASES[job.workflowFile] ?? job.workflowFile)
    }
  }

  const mappingHints = bundle
    ? [
        bundle.mapping.prompt ? "提示词" : null,
        bundle.mapping.firstFrame ? "首帧" : null,
        bundle.mapping.lastFrame ? "尾帧" : null,
        bundle.mapping.dynamicRefs ? "参考（可添加）" : null,
        bundle.mapping.duration ? "时长" : null,
        bundle.mapping.seed ? "seed" : null,
        bundle.mapping.loras.length ? `LoRA ×${bundle.mapping.loras.length}` : null,
      ].filter(Boolean)
    : []

  const durationSeconds = Number(duration) || 0
  const mediaSlots = (bundle?.mapping.media ?? []).filter(
    (slot) => slot.role === "firstFrame" || slot.role === "lastFrame"
  )
  const hasFirstFrameMapping = Boolean(
    mediaSlots.some((slot) => slot.role === "firstFrame")
  )
  const hasLastFrameMapping = Boolean(
    mediaSlots.some((slot) => slot.role === "lastFrame")
  )
  const dynamicRefs = Boolean(bundle?.mapping.dynamicRefs)
  const taggedDrafts = taggedRefs(refDrafts)
  const usingFirstFrame = Boolean(slotFiles.firstFrame && hasFirstFrameMapping)
  const guideMode = resolveGuideMode({
    dynamicRefs,
    hasLastFrame: hasLastFrameMapping,
    hasFirstFrame: hasFirstFrameMapping,
  })
  const promptHint = promptCoachHint({
    hasFirstFrame: usingFirstFrame,
    hasLastFrame: Boolean(slotFiles.lastFrame && hasLastFrameMapping),
    refTags: taggedDrafts.map((item) => item.tag),
    dynamicRefs,
    durationSeconds,
  })
  const guideVisible = guideOpen || guidePinned
  const hasSteps = Boolean(bundle?.mapping.steps)
  const hasCfg = Boolean(bundle?.mapping.cfg)
  const grouped = groupWorkflows(workflows)
  const currentWorkflow = workflows.find((item) => item.name === workflowName)

  const generateBar = (
    <div className="flex gap-2">
      <Button
        type="button"
        size="lg"
        className="h-11 flex-1"
        disabled={busy || submitting || !workflowName}
        onClick={() => void submit(false)}
      >
        {submitting || busy ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PlayIcon data-icon="inline-start" />
        )}
        {busy ? "生成中" : "生成"}
      </Button>
      {busy ? (
        <Button
          type="button"
          size="lg"
          className="h-11"
          variant="outline"
          onClick={() => {
            if (!current) return
            void fetch(`/api/jobs/${current.id}`, { method: "DELETE" })
          }}
        >
          <SquareIcon data-icon="inline-start" />
          中断
        </Button>
      ) : null}
    </div>
  )

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="relative z-10 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 lg:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-7 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="font-heading text-lg font-semibold tracking-tight text-pretty">
              MiniMax H3 Studio
            </h1>
            <p className="max-w-[48ch] text-xs leading-relaxed text-muted-foreground text-pretty">
              本机 ComfyUI 出片台
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 font-mono text-[11px] tabular-nums">
            <span
              className={cn("size-1.5 rounded-full", connected ? "lamp-live" : "lamp-off")}
              aria-hidden="true"
            />
            {connected
              ? health?.queueRemaining
                ? `本机 ${health.port} 队列 ${health.queueRemaining}`
                : `本机 ${health?.port ?? 8188}`
              : "未连接"}
          </span>
          {!connected ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void loadHealth()}>
              <RefreshCwIcon data-icon="inline-start" />
              重试
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" asChild>
            <a href={comfyUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              ComfyUI
            </a>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2Icon data-icon="inline-start" />
            设置
          </Button>
        </div>
      </header>

      <div
        id="studio-main"
        className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]"
      >
        <section className="relative flex min-h-0 flex-col border-b lg:max-h-[calc(100dvh-3.75rem)] lg:border-r lg:border-b-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-6">
            {!connected ? (
              <Alert className="mb-5">
                <AlertTitle>还没有连上 ComfyUI</AlertTitle>
                <AlertDescription>
                  请在本机启动 ComfyUI（默认 8188），然后再生成。Studio
                  不会代装模型，也不会改你的节点图。
                </AlertDescription>
              </Alert>
            ) : null}

            {workflows.length === 0 ? (
              <Empty className="border bg-card/40">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ClapperboardIcon />
                  </EmptyMedia>
                  <EmptyTitle>没有可用的工作流</EmptyTitle>
                  <EmptyDescription>
                    仓库自带官方和 Turbo 预设。若这里是空的，检查 templates/workflows/，或在设置里上传自己的 API JSON。
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" onClick={() => setSettingsOpen(true)}>
                    打开设置
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <FieldGroup>
                <Field>
                  <LabelWithHelp label="工作流">
                    官方 20 步、Turbo 6 步，或参考生（另一套 Ref2VA 权重）。上传区随当前图上的节点出现。
                  </LabelWithHelp>
                  <Select
                    value={workflowName}
                    onValueChange={(name) => {
                      setWorkflowName(name)
                      void loadBundle(name)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择工作流" />
                    </SelectTrigger>
                    <SelectContent>
                      {grouped.official.length > 0 ? (
                        <SelectGroup>
                          <SelectLabel>官方</SelectLabel>
                          {grouped.official.map((item) => (
                            <SelectItem key={item.name} value={item.name}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                      {grouped.turbo.length > 0 ? (
                        <SelectGroup>
                          <SelectLabel>Turbo LoRA</SelectLabel>
                          {grouped.turbo.map((item) => (
                            <SelectItem key={item.name} value={item.name}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                      {grouped.reference.length > 0 ? (
                        <SelectGroup>
                          <SelectLabel>参考生</SelectLabel>
                          {grouped.reference.map((item) => (
                            <SelectItem key={item.name} value={item.name}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                      {grouped.custom.length > 0 ? (
                        <SelectGroup>
                          <SelectLabel>我的</SelectLabel>
                          {grouped.custom.map((item) => (
                            <SelectItem key={item.name} value={item.name}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {[
                      currentWorkflow?.description,
                      mappingHints.length
                        ? `已识别：${mappingHints.join("、")}`
                        : "未识别到常用字段，请到设置里手动映射",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </FieldDescription>
                </Field>

                <Field>
                  <div className="flex items-baseline justify-between gap-3">
                    <LabelWithHelp htmlFor="prompt" label="提示词">
                      正文建议英文。对白、歌词、画面上的字保留原文。观众配乐写在
                      non_diegetic_music，没有就写 N/A。
                    </LabelWithHelp>
                    <span
                      className="font-mono text-[11px] tabular-nums text-muted-foreground"
                      aria-label={`字数 ${prompt.length}`}
                    >
                      {prompt.length}
                    </span>
                  </div>
                  <Textarea
                    ref={textareaRef}
                    id="prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onFocus={() => setGuideOpen(true)}
                    placeholder={PROMPT_PLACEHOLDER}
                    aria-describedby="prompt-hint"
                    className="min-h-44"
                  />
                  <FieldDescription id="prompt-hint">{promptHint}</FieldDescription>
                </Field>

                <MediaSlots
                  slots={mediaSlots}
                  files={slotFiles}
                  onChange={setSlotFile}
                />

                {dynamicRefs ? (
                  <ReferenceSlots
                    drafts={refDrafts}
                    onAdd={addRefFiles}
                    onRemove={removeRefDraft}
                  />
                ) : null}

                <Field>
                  <LabelWithHelp label="时长">
                    成片大约几秒，会写入工作流的时长或帧数。13-15 秒要有一条清楚的动作推进。
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
                    画面比例，对应工作流里的宽和高。选了会覆盖 JSON 里原来的分辨率。
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
                  <LabelWithHelp htmlFor="seed" label="Seed">
                    这是这次成片的编号。数字大小没有好坏，换一个等于重新抽一次构图和口气；提示词和参数不变时，同一个编号更容易长得像。默认每次换编号。看中了就关掉「随机」，锁住框里刚生成用过的那个数；或者点右侧历史里那一条，再生成就不会另抽。
                  </LabelWithHelp>
                  <div className="flex items-center gap-2">
                    <Input
                      id="seed"
                      className="font-mono tabular-nums"
                      inputMode="numeric"
                      value={seed}
                      onChange={(event) => setSeed(Number(event.target.value) || 0)}
                      disabled={randomize}
                    />
                    <div className="flex items-center gap-2 whitespace-nowrap text-sm">
                      <Switch
                        checked={randomize}
                        onCheckedChange={setRandomize}
                        id="randomize"
                      />
                      <label htmlFor="randomize">随机</label>
                    </div>
                  </div>
                </Field>

                {hasSteps || hasCfg ? (
                  <div
                    className={cn(
                      "grid gap-3",
                      hasSteps && hasCfg ? "grid-cols-2" : "grid-cols-1"
                    )}
                  >
                    {hasSteps ? (
                      <Field>
                        <LabelWithHelp htmlFor="steps" label="步数">
                          采样步数。开了加速 LoRA 时偶尔要改，一般留空用工作流默认。
                        </LabelWithHelp>
                        <Input
                          id="steps"
                          className="font-mono tabular-nums"
                          value={steps}
                          onChange={(event) => setSteps(event.target.value)}
                          placeholder="工作流默认"
                        />
                      </Field>
                    ) : null}
                    {hasCfg ? (
                      <Field>
                        <LabelWithHelp htmlFor="cfg" label="CFG">
                          提示词约束强度。越大越听 prompt，太高容易发硬、不自然。常见默认约
                          7。
                        </LabelWithHelp>
                        <Input
                          id="cfg"
                          className="font-mono tabular-nums"
                          value={cfg}
                          onChange={(event) => setCfg(event.target.value)}
                          placeholder="工作流默认"
                        />
                      </Field>
                    ) : null}
                  </div>
                ) : null}

                {loras.length > 0 ? (
                  <FieldGroup>
                    {loras.map((lora, index) => (
                      <Field key={`${lora.nodeId}-${index}`}>
                        <LabelWithHelp label={`LoRA ${index + 1}`}>
                          工作流里检测到的 LoRA（含 MiniMax H3 Turbo LoRA）。可开关、换文件、调强度。关掉等于强度为
                          0，不会从节点图里删掉。
                        </LabelWithHelp>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={lora.enabled}
                            onCheckedChange={(enabled) => {
                              setLoras((list) =>
                                list.map((item, i) =>
                                  i === index ? { ...item, enabled } : item
                                )
                              )
                            }}
                          />
                          <span className="text-sm">启用</span>
                        </div>
                        {loraFiles.length > 0 ? (
                          <Select
                            value={lora.name || undefined}
                            onValueChange={(name) => {
                              setLoras((list) =>
                                list.map((item, i) =>
                                  i === index ? { ...item, name } : item
                                )
                              )
                            }}
                            disabled={!lora.enabled}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="选择 LoRA 文件" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {loraFiles.map((name) => (
                                  <SelectItem key={name} value={name}>
                                    {name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            value={lora.name}
                            disabled={!lora.enabled}
                            onChange={(event) => {
                              const name = event.target.value
                              setLoras((list) =>
                                list.map((item, i) =>
                                  i === index ? { ...item, name } : item
                                )
                              )
                            }}
                          />
                        )}
                        <Slider
                          min={0}
                          max={2}
                          step={0.05}
                          value={[lora.strength]}
                          disabled={!lora.enabled}
                          onValueChange={(value) => {
                            const strength = value[0] ?? 1
                            setLoras((list) =>
                              list.map((item, i) =>
                                i === index ? { ...item, strength } : item
                              )
                            )
                          }}
                        />
                        <FieldDescription className="font-mono tabular-nums">
                          强度 {lora.strength.toFixed(2)}
                        </FieldDescription>
                      </Field>
                    ))}
                  </FieldGroup>
                ) : null}

              </FieldGroup>
            )}
          </div>
          {workflows.length > 0 ? (
            <div className="border-t bg-background/95 p-4">{generateBar}</div>
          ) : null}
        </section>

        <section
          ref={monitorRef}
          className="flex min-h-0 flex-col gap-4 p-4 lg:max-h-[calc(100dvh-3.75rem)] lg:overflow-hidden"
        >
          <div className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
              <span className="text-sm font-medium">成片</span>
              {current ? (
                <MetaBits
                  items={[
                    statusLabel(current),
                    `${current.duration}s`,
                    current.aspect,
                    `seed ${current.seed}`,
                  ]}
                />
              ) : (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {aspect} {duration}s
                </span>
              )}
            </div>
            <div
              className={cn(
                "relative flex min-h-64 flex-1 items-center justify-center studio-letterbox",
                busy && "studio-scan"
              )}
              aria-live="polite"
            >
              {current?.outputUrl && current.status === "success" ? (
                <video
                  key={current.outputUrl}
                  className="max-h-[min(32rem,55dvh)] w-full object-contain"
                  src={current.outputUrl}
                  controls
                  autoPlay
                />
              ) : busy ? (
                <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-4 p-8">
                  <p className="text-sm text-muted-foreground">
                    {current?.progress?.nodeTitle ||
                      (current?.progress?.node
                        ? `节点 ${current.progress.node}`
                        : "已提交，等待 ComfyUI")}
                  </p>
                  <Progress value={progressPercent} className="w-full" />
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {current?.progress?.max
                      ? `${current.progress.value} / ${current.progress.max}`
                      : "排队或加载模型中"}
                  </p>
                </div>
              ) : current?.status === "error" ? (
                <div className="w-full max-w-lg p-6">
                  <Alert variant="destructive">
                    <AlertTitle>生成失败</AlertTitle>
                    <AlertDescription>{current.error}</AlertDescription>
                  </Alert>
                </div>
              ) : (
                <div
                  className="flex w-full max-w-xl flex-col items-center justify-center gap-3 border border-dashed border-border/70 p-8 text-center"
                  style={{ aspectRatio: aspect.replace(":", " / ") }}
                >
                  <p className="text-sm font-medium">还没有成片</p>
                  <p className="max-w-[36ch] text-sm leading-relaxed text-muted-foreground text-pretty">
                    写好提示词后点生成。进度走 ComfyUI 的 websocket，成片会复制到
                    outputs/ 目录。
                  </p>
                </div>
              )}
            </div>
            {current ? (
              <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {current.workflowFile}
                </span>
                <div className="ml-auto flex gap-2">
                  {current.outputUrl ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={current.outputUrl} download>
                        <DownloadIcon data-icon="inline-start" />
                        下载成片
                      </a>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" asChild>
                    <a href={current.workflowUrl} download>
                      本次 JSON
                    </a>
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 className="text-sm font-medium">历史</h2>
              <p className="text-xs text-muted-foreground">点一条即可回填再出</p>
            </div>
            {jobs.length === 0 ? (
              <Empty className="rounded-xl border bg-card/40 py-8">
                <EmptyHeader>
                  <EmptyTitle>没有记录</EmptyTitle>
                  <EmptyDescription>
                    第一次生成成功后，提示词、参数和成片会留在这里。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <ul className="flex gap-2">
                  {jobs.map((job, index) => (
                    <li key={job.id} className="w-44 shrink-0">
                      <button
                        type="button"
                        aria-current={current?.id === job.id ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-col gap-2 rounded-lg border bg-card p-2 text-left transition-colors hover:bg-muted/60",
                          current?.id === job.id && "border-primary/70 bg-primary/10"
                        )}
                        onClick={() => fillFromJob(job)}
                      >
                        <div className="relative aspect-video overflow-hidden rounded-md studio-letterbox">
                          {job.outputUrl ? (
                            <video
                              src={job.outputUrl}
                              muted
                              playsInline
                              preload="metadata"
                              className="size-full object-cover"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center font-mono text-[10px] text-muted-foreground">
                              {statusLabel(job)}
                            </div>
                          )}
                          <span className="absolute top-1.5 left-1.5 rounded bg-monitor/80 px-1 font-mono text-[10px] tabular-nums text-foreground/80">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                        </div>
                        <span className="line-clamp-2 text-xs leading-snug">
                          {job.prompt || "（无提示词）"}
                        </span>
                        <MetaBits items={[`${job.duration}s`, job.aspect]} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>

      <PromptGuide
        open={guideVisible}
        pinned={guidePinned}
        compact={busy && guidePinned}
        mode={guideMode}
        duration={durationSeconds}
        prompt={prompt}
        textareaRef={textareaRef}
        monitorRef={monitorRef}
        onPinnedChange={(next) => {
          setGuidePinned(next)
          if (next) setGuideOpen(true)
          else if (document.activeElement !== textareaRef.current) {
            setGuideOpen(false)
          }
        }}
        onClose={() => setGuideOpen(false)}
        onApply={(next, selection) => {
          setPrompt(next)
          setGuideOpen(true)
          requestAnimationFrame(() => {
            const el = textareaRef.current
            if (!el) return
            el.focus()
            el.setSelectionRange(selection.start, selection.end)
          })
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        port={port}
        comfyUrl={comfyUrl}
        connected={connected}
        workflowName={workflowName}
        workflows={workflows}
        bundle={bundle}
        onPortChange={async (nextPort) => {
          const response = await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comfyPort: nextPort }),
          })
          const json = (await response.json()) as { error?: string; comfyPort?: number }
          if (!response.ok) throw new Error(json.error ?? "保存失败")
          setPort(nextPort)
          setComfyUrl(`http://127.0.0.1:${nextPort}`)
          await loadHealth()
        }}
        onImported={async (name) => {
          await loadWorkflows(name)
          setWorkflowName(name)
          await loadBundle(name)
        }}
        onDeleted={async (name) => {
          const response = await fetch(`/api/workflows/${encodeURIComponent(name)}`, {
            method: "DELETE",
          })
          const json = (await response.json()) as {
            error?: string
            restored?: boolean
          }
          if (!response.ok) throw new Error(json.error ?? "删除失败")
          if (json.restored) toast.success("已恢复官方预设")
          const { selected } = await loadWorkflows(null, workflowName === name ? undefined : workflowName)
          if (workflowName === name) {
            setWorkflowName(selected)
            await loadBundle(selected)
          }
        }}
        onMappingSaved={(next) => setBundle(next)}
      />

      <AlertDialog open={busyOpen} onOpenChange={setBusyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ComfyUI 正在忙</AlertDialogTitle>
            <AlertDialogDescription>
              队列里已有任务。仍要继续提交的话，Studio 会把这一条排到后面。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setBusyOpen(false)
                void submit(true)
              }}
            >
              仍然提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ClapperboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
  SquareIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ComposeDialog } from "@/components/studio/compose-dialog"
import { ComposeForm } from "@/components/studio/compose-form"
import { PromptGuide } from "@/components/studio/prompt-guide"
import { type SlotFile } from "@/components/studio/media-slots"
import {
  taggedRefs,
  type RefDraft,
} from "@/components/studio/reference-slots"
import { SettingsDialog } from "@/components/studio/settings-dialog"
import { TaskList, isBusyJob, statusLabel } from "@/components/studio/task-list"
import type { WorkflowBundle } from "@/components/studio/types"
import type { HealthStatus, LoraFormValue, MediaKind, PublicJob } from "@/lib/types"
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
    return "聚焦提示词，右侧对照写法。参考生先定义标签，再写画面。"
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
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeMode, setComposeMode] = useState<"new" | "detail">("new")
  const [composeJobId, setComposeJobId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PublicJob | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guidePinned, setGuidePinned] = useState(false)

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
  const eventSourceRef = useRef<EventSource | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const connected = Boolean(health?.ok)
  const busy = Boolean(current && isBusyJob(current))

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
    async (name: string, options?: { keepValues?: boolean }) => {
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
      if (options?.keepValues) {
        setBundle(json)
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
      setCurrent((prev) => (prev?.id === payload.job!.id ? payload.job! : prev))
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
    const active = json.jobs.find(isBusyJob)
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
      setComposeOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  function fillFromJob(job: PublicJob) {
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

  async function openNew() {
    if (!workflowName) {
      toast.error("请先导入工作流")
      return
    }
    setComposeMode("new")
    setComposeJobId(null)
    await loadBundle(workflowName)
    setPrompt("")
    setRandomize(true)
    setComposeOpen(true)
  }

  async function openDetail(job: PublicJob) {
    const name = job.workflowFile
      ? (WORKFLOW_ALIASES[job.workflowFile] ?? job.workflowFile)
      : workflowName
    setComposeMode("detail")
    setComposeJobId(job.id)
    setCurrent(job)
    if (name && name !== workflowName) {
      await loadBundle(name, { keepValues: true })
    }
    fillFromJob(job)
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
    setComposeOpen(true)
  }

  async function deleteJob(job: PublicJob) {
    const response = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" })
    const json = (await response.json()) as { deleted?: boolean; error?: string }
    if (!response.ok || !json.deleted) {
      toast.error(json.error ?? "删除失败")
      return
    }
    setJobs((list) => list.filter((item) => item.id !== job.id))
    if (current?.id === job.id) setCurrent(null)
    if (composeJobId === job.id) {
      setComposeOpen(false)
      setComposeJobId(null)
    }
    toast.success("已删除任务")
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
      ].filter((item): item is string => Boolean(item))
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
  const hasSteps = Boolean(bundle?.mapping.steps)
  const hasCfg = Boolean(bundle?.mapping.cfg)
  const grouped = groupWorkflows(workflows)
  const currentWorkflow = workflows.find((item) => item.name === workflowName)
  const activeJob = jobs.find(isBusyJob)
  const composeJob = composeJobId
    ? jobs.find((item) => item.id === composeJobId)
    : undefined
  const composeReadOnly = Boolean(composeMode === "detail" && composeJob && isBusyJob(composeJob))
  const composeTitle = composeMode === "detail" ? "任务详情" : "新建任务"
  const composeHint = composeReadOnly
    ? "进行中不能改参数。要中断请先关掉，到监视器操作。"
    : composeMode === "detail"
      ? "会新开一条任务，不会改列表里这条。"
      : "生成后会出现在左侧任务列表。"
  const generateLabel = submitting ? "提交中" : "生成"
  const generateDisabled = composeReadOnly || submitting || !workflowName

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
          <div className="flex shrink-0 flex-col gap-3 border-b p-4">
            {!connected ? (
              <Alert>
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
              <Button type="button" size="lg" className="h-11 w-full" onClick={() => void openNew()}>
                <PlusIcon data-icon="inline-start" />
                新建
              </Button>
            )}
          </div>
          {workflows.length > 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <TaskList
                jobs={jobs}
                currentId={current?.id}
                onSelect={setCurrent}
                onOpenDetail={(job) => void openDetail(job)}
                onDelete={setDeleteTarget}
              />
            </div>
          ) : null}
        </section>

        <section
          className="flex min-h-0 flex-col gap-4 p-4 lg:max-h-[calc(100dvh-3.75rem)] lg:overflow-hidden"
        >
          <div className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
              <span className="text-sm font-medium">成片</span>
              <div className="flex min-w-0 items-center gap-2">
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
                {activeJob ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void fetch(`/api/jobs/${activeJob.id}`, { method: "DELETE" })
                    }}
                  >
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
                    点左侧新建，写好提示词后生成。进度走 ComfyUI 的 websocket，成片会复制到
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
        </section>
      </div>

      <ComposeDialog
        open={composeOpen}
        title={composeTitle}
        hint={composeHint}
        generateDisabled={generateDisabled}
        generateLabel={generateLabel}
        submitting={submitting}
        onOpenChange={(open) => {
          setComposeOpen(open)
          if (!open) {
            setGuideOpen(false)
            setGuidePinned(false)
          }
        }}
        onGenerate={() => void submit(false)}
        guide={
          <PromptGuide
            docked
            open={composeOpen && (guideOpen || guidePinned)}
            pinned={guidePinned}
            mode={guideMode}
            duration={durationSeconds}
            prompt={prompt}
            textareaRef={textareaRef}
            disabled={composeReadOnly}
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
        }
      >
        <ComposeForm
          readOnly={composeReadOnly}
          workflows={workflows}
          workflowName={workflowName}
          grouped={grouped}
          currentWorkflow={currentWorkflow}
          mappingHints={mappingHints}
          prompt={prompt}
          promptHint={promptHint}
          textareaRef={textareaRef}
          duration={duration}
          aspect={aspect}
          seed={seed}
          randomize={randomize}
          steps={steps}
          cfg={cfg}
          loras={loras}
          loraFiles={loraFiles}
          hasSteps={hasSteps}
          hasCfg={hasCfg}
          mediaSlots={mediaSlots}
          slotFiles={slotFiles}
          dynamicRefs={dynamicRefs}
          refDrafts={refDrafts}
          onWorkflowChange={(name) => {
            setWorkflowName(name)
            void loadBundle(name)
          }}
          onPromptChange={setPrompt}
          onPromptFocus={() => setGuideOpen(true)}
          onDurationChange={setDuration}
          onAspectChange={setAspect}
          onSeedChange={setSeed}
          onRandomizeChange={setRandomize}
          onStepsChange={setSteps}
          onCfgChange={setCfg}
          onLorasChange={setLoras}
          onSlotFile={setSlotFile}
          onAddRefs={addRefFiles}
          onRemoveRef={removeRefDraft}
        />
      </ComposeDialog>

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

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条任务？</AlertDialogTitle>
            <AlertDialogDescription>
              会从任务列表拿掉，并删除 outputs 里对应的成片。此操作不能恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return
                const job = deleteTarget
                setDeleteTarget(null)
                void deleteJob(job)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

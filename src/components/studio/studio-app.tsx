"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  ClapperboardIcon,
  ExternalLinkIcon,
  FilmIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ComposeForm } from "@/components/studio/compose-form"
import { PromptGuide } from "@/components/studio/prompt-guide"
import { type SlotFile } from "@/components/studio/media-slots"
import {
  taggedRefs,
  type RefDraft,
} from "@/components/studio/reference-slots"
import { SettingsDialog } from "@/components/studio/settings-dialog"
import { TaskList } from "@/components/studio/task-list"
import { QueuePanel } from "@/components/studio/queue-panel"
import { MonitorPanel, type MonitorMode } from "@/components/studio/monitor-panel"
import { LongWorkspace, type LongGeneratePayload } from "@/components/studio/long-workspace"
import { HomeBootSkeleton } from "@/components/studio/home-boot-skeleton"
import { ThemeToggle } from "@/components/studio/theme-toggle"
import { WorkspaceSplit } from "@/components/studio/workspace-split"
import type { WorkflowBundle } from "@/components/studio/types"
import type { HealthStatus, LoraFormValue, MediaKind, PublicJob, StudioQueueSnapshot } from "@/lib/types"
import type { WorkflowListItem } from "@/lib/default-workflows"
import { workflowEnvironmentLine } from "@/lib/default-workflows"
import type { EnvironmentLine, EnvironmentStatus } from "@/lib/environment-types"
import {
  REF_LIMITS,
  WORKFLOW_ALIASES,
  fileMatchesKind,
  refKindLabel,
  refSlotId,
} from "@/lib/refs"
import { resolveGuideMode } from "@/lib/prompt-guide"
import { isBusyJob, isLongJob, isWaitingJob } from "@/lib/job-view"
import { waitingSegment } from "@/lib/long-video"
import { cn } from "@/lib/utils"

function emptyQueue(): StudioQueueSnapshot {
  return { paused: false, remaining: 0, items: [] }
}

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

function groupWorkflows(items: WorkflowListItem[]) {
  return {
    official: items.filter((item) => item.family === "official"),
    turbo: items.filter((item) => item.family === "turbo"),
    reference: items.filter((item) => item.family === "reference"),
    custom: items.filter((item) => item.family === "custom"),
  }
}

type Shell = "home" | "short" | "long"

export function StudioApp() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [port, setPort] = useState(8188)
  const [comfyUrl, setComfyUrl] = useState("http://127.0.0.1:8188")
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [workflowName, setWorkflowName] = useState("")
  const [bundle, setBundle] = useState<WorkflowBundle | null>(null)
  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [queue, setQueue] = useState<StudioQueueSnapshot>(emptyQueue)
  const [current, setCurrent] = useState<PublicJob | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [focusEnvironment, setFocusEnvironment] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [shell, setShell] = useState<Shell>("home")
  const [workspaceJobId, setWorkspaceJobId] = useState<string | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<PublicJob[]>([])
  const [guideOpen, setGuideOpen] = useState(false)
  const [guidePinned, setGuidePinned] = useState(false)
  const [monitorMode, setMonitorMode] = useState<MonitorMode>("current")
  const [booting, setBooting] = useState(true)
  const [healthBusy, setHealthBusy] = useState(false)

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
  const monitorRef = useRef<HTMLElement | null>(null)

  const connected = Boolean(health?.ok)
  const busy = Boolean(current && isBusyJob(current))
  const environmentLine: EnvironmentLine =
    shell === "long" ? "long" : workflowEnvironmentLine(workflowName)

  async function ensureEnvironment(line: EnvironmentLine) {
    const response = await fetch(`/api/environment?line=${encodeURIComponent(line)}`)
    const json = (await response.json()) as EnvironmentStatus
    if (json.ready) return true
    setFocusEnvironment(true)
    setSettingsOpen(true)
    toast.error(json.summary)
    return false
  }

  const loadHealth = useCallback(async () => {
    const response = await fetch("/api/health")
    const json = (await response.json()) as HealthStatus
    setHealth(json)
  }, [])

  async function retryHealth() {
    setHealthBusy(true)
    try {
      await loadHealth()
    } finally {
      setHealthBusy(false)
    }
  }

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
        picker: true,
      }))
    setWorkflows(list)
    const names = list.filter((item) => item.picker !== false).map((item) => item.name)
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
      const next = payload.job
      setCurrent((prev) => (prev?.id === next.id ? next : prev))
      setJobs((list) => {
        const rest = list.filter((item) => item.id !== next.id)
        return [next, ...rest]
      })
      if (
        next.status === "success" ||
        next.status === "error" ||
        next.status === "interrupted" ||
        next.status === "awaiting"
      ) {
        source.close()
        if (next.kind === "long") {
          const last = next.long?.segments[next.long.segments.length - 1]
          if (next.status === "awaiting" && last?.status === "success") {
            toast.success(`第 ${last.index} 段已写入`)
          } else if (next.status === "awaiting" && last?.status === "interrupted") {
            toast.message("已中断本段，可重试")
          } else if (next.status === "success") {
            toast.success("长视频已定稿")
          } else if (next.status === "error") {
            toast.error(next.error ?? "这一段失败")
          }
        } else {
          if (next.status === "success") toast.success("成片已写入 Studio 输出目录")
          if (next.status === "error") toast.error(next.error ?? "生成失败")
        }
        void fetch("/api/jobs")
          .then((response) => response.json())
          .then((json: { jobs?: PublicJob[]; queue?: StudioQueueSnapshot }) => {
            if (json.jobs) setJobs(json.jobs)
            if (json.queue) setQueue(json.queue)
          })
      }
    }
    source.onerror = () => {
      source.close()
    }
  }, [])

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/jobs")
    const json = (await response.json()) as {
      jobs: PublicJob[]
      queue?: StudioQueueSnapshot
    }
    setJobs(json.jobs)
    if (json.queue) setQueue(json.queue)
    return json.jobs
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await Promise.all([
          (async () => {
            try {
              const preferred = await loadSettings()
              const { selected } = await loadWorkflows(preferred)
              if (selected) void loadBundle(selected)
            } catch {
              toast.error("读取工作流失败")
            }
          })(),
          (async () => {
            try {
              await loadJobs()
            } catch {
              toast.error("读取任务失败")
            }
          })(),
          (async () => {
            try {
              await loadHealth()
            } catch {
              // 结束后按未连接处理
            }
          })(),
        ])
      } finally {
        if (!cancelled) setBooting(false)
      }
      try {
        const loraRes = await fetch("/api/loras")
        const loraJson = (await loraRes.json()) as { loras?: string[] }
        if (!cancelled) setLoraFiles(loraJson.loras ?? [])
      } catch {
        // 新建时再拉一次即可
      }
    })()
    const timer = setInterval(() => {
      void loadHealth().catch(() => {})
      void loadJobs().catch(() => {})
    }, 4000)
    return () => {
      cancelled = true
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
      const currentDraft = previous.find((item) => item.id === id)
      if (currentDraft) URL.revokeObjectURL(currentDraft.preview)
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

  function goHome() {
    setShell("home")
    setGuideOpen(false)
    setGuidePinned(false)
    setWorkspaceJobId(null)
    setMonitorMode("current")
  }

  function enterWorkspace(next: Shell, job: PublicJob | null) {
    setShell(next)
    setWorkspaceJobId(job?.id ?? null)
    setCurrent(job)
    setMonitorMode("current")
    setGuideOpen(false)
    setGuidePinned(false)
    if (next === "long") setPrompt("")
    if (job && (isBusyJob(job) || isWaitingJob(job))) listenJob(job.id)
  }

  async function submitShort() {
    if (!workflowName) {
      toast.error("请先导入工作流")
      return
    }
    if (!prompt.trim()) {
      toast.error("请填写提示词")
      return
    }
    if (!(await ensureEnvironment(environmentLine))) return
    const watching = workspaceJobId
      ? (jobs.find((item) => item.id === workspaceJobId) ?? current)
      : current
    const stayOnMonitor = Boolean(watching && isBusyJob(watching))
    setSubmitting(true)
    try {
      const form = new FormData()
      form.set("workflowFile", workflowName)
      form.set("prompt", prompt)
      form.set("duration", duration)
      form.set("aspect", aspect)
      form.set("seed", String(randomize ? randomSeed() : seed))
      form.set("loras", JSON.stringify(loras))
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
        queue?: StudioQueueSnapshot
        error?: string
        code?: string
      }
      if (response.status === 412 && json.code === "environment_incomplete") {
        setFocusEnvironment(true)
        setSettingsOpen(true)
        toast.error(json.error ?? "环境还没就绪")
        return
      }
      if (!response.ok || !json.job) {
        toast.error(json.error ?? "提交失败")
        if (json.job) {
          setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
        }
        return
      }
      if (json.queue) setQueue(json.queue)
      setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
      if (json.job.status === "waiting") {
        const ahead = json.queue?.items.findIndex((item) => item.jobId === json.job!.id) ?? -1
        toast.message(
          ahead > 0 ? `已排队，前面还有 ${ahead} 条` : "已排队，轮到就会开跑"
        )
      }
      if (!stayOnMonitor) {
        setCurrent(json.job)
        setWorkspaceJobId(json.job.id)
        listenJob(json.job.id)
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function submitLong(payload: LongGeneratePayload) {
    if (!current || current.kind !== "long") return
    if (!(await ensureEnvironment("long"))) return
    setSubmitting(true)
    try {
      const response = await fetch(`/api/jobs/${current.id}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = (await response.json()) as {
        job?: PublicJob
        queue?: StudioQueueSnapshot
        error?: string
        code?: string
        installUrl?: string
      }
      if (response.status === 412 && json.code === "environment_incomplete") {
        setFocusEnvironment(true)
        setSettingsOpen(true)
        toast.error(json.error ?? "环境还没就绪")
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
      if (json.queue) setQueue(json.queue)
      setCurrent(json.job)
      setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
      if (json.job.status === "waiting") {
        const ahead = json.queue?.items.findIndex((item) => item.jobId === json.job!.id) ?? -1
        toast.message(
          ahead > 0 ? `已排队，前面还有 ${ahead} 条` : "已排队，轮到就会开跑"
        )
      }
      listenJob(json.job.id)
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

  async function openNewShort() {
    if (!workflowName) {
      toast.error("请先导入工作流")
      return
    }
    await loadBundle(workflowName)
    setPrompt("")
    setRandomize(true)
    enterWorkspace("short", null)
  }

  async function openNewLong() {
    const form = new FormData()
    form.set("kind", "long")
    form.set("aspect", aspect)
    const response = await fetch("/api/jobs", { method: "POST", body: form })
    const json = (await response.json()) as { job?: PublicJob; error?: string }
    if (!response.ok || !json.job) {
      toast.error(json.error ?? "无法创建长视频任务")
      return
    }
    setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
    enterWorkspace("long", json.job)
  }

  async function openJob(job: PublicJob) {
    if (isLongJob(job)) {
      enterWorkspace("long", job)
      if (isBusyJob(job) || isWaitingJob(job)) listenJob(job.id)
      return
    }
    const name = job.workflowFile
      ? (WORKFLOW_ALIASES[job.workflowFile] ?? job.workflowFile)
      : workflowName
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
    enterWorkspace("short", job)
    if (isBusyJob(job) || isWaitingJob(job)) listenJob(job.id)
  }

  async function deleteJob(job: PublicJob) {
    const response = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" })
    const json = (await response.json()) as {
      deleted?: boolean
      job?: PublicJob
      error?: string
    }
    if (json.job && isBusyJob(job)) {
      setCurrent((prev) => (prev?.id === json.job!.id ? json.job! : prev))
      setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
      return
    }
    if (!response.ok || !json.deleted) {
      toast.error(json.error ?? "删除失败")
      return
    }
    setJobs((list) => list.filter((item) => item.id !== job.id))
    if (current?.id === job.id) setCurrent(null)
    if (workspaceJobId === job.id) goHome()
    toast.success("已删除任务")
  }

  async function deleteJobs(targets: PublicJob[]) {
    const ids = targets.map((item) => item.id)
    const response = await fetch("/api/jobs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
    const json = (await response.json()) as {
      deleted?: string[]
      skipped?: string[]
      error?: string
    }
    if (!response.ok) {
      toast.error(json.error ?? "删除失败")
      return
    }
    const deleted = new Set(json.deleted ?? [])
    setJobs((list) => list.filter((item) => !deleted.has(item.id)))
    if (current && deleted.has(current.id)) setCurrent(null)
    if (workspaceJobId && deleted.has(workspaceJobId)) goHome()
    const skipped = json.skipped?.length ?? 0
    if (skipped > 0) {
      toast.success(`已删除 ${deleted.size} 条，跳过 ${skipped} 条进行中的任务`)
    } else {
      toast.success(deleted.size > 1 ? `已删除 ${deleted.size} 条任务` : "已删除任务")
    }
  }

  async function finalizeLong(finalized: boolean) {
    if (!current) return
    const response = await fetch(`/api/jobs/${current.id}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finalized }),
    })
    const json = (await response.json()) as { job?: PublicJob; error?: string }
    if (!response.ok || !json.job) {
      toast.error(json.error ?? "操作失败")
      return
    }
    setCurrent(json.job)
    setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
    toast.success(finalized ? "已定稿" : "已撤销定稿，可继续")
  }

  async function retryStitch() {
    if (!current) return
    const response = await fetch(`/api/jobs/${current.id}/stitch`, { method: "POST" })
    const json = (await response.json()) as { job?: PublicJob; error?: string }
    if (!response.ok || !json.job) {
      toast.error(json.error ?? "拼接失败")
      if (json.job) {
        setCurrent(json.job)
        setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
      }
      return
    }
    setCurrent(json.job)
    setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
    toast.success("已重新拼接")
  }

  async function resumeQueue() {
    const response = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    })
    const json = (await response.json()) as {
      queue?: StudioQueueSnapshot
      error?: string
    }
    if (!response.ok) {
      toast.error(json.error ?? "无法继续队列")
      return
    }
    if (json.queue) setQueue(json.queue)
    await loadJobs()
    toast.message("队列已继续")
  }

  async function withdrawQueueItem(job: PublicJob) {
    const response = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "withdraw", jobId: job.id }),
    })
    const json = (await response.json()) as {
      withdrawn?: string
      job?: PublicJob
      queue?: StudioQueueSnapshot
      error?: string
    }
    if (!response.ok) {
      toast.error(json.error ?? "无法从队列撤下")
      return
    }
    if (json.queue) setQueue(json.queue)
    if (json.withdrawn === "job") {
      setJobs((list) => list.filter((item) => item.id !== job.id))
      if (current?.id === job.id) setCurrent(null)
      if (workspaceJobId === job.id) goHome()
      toast.success("已从队列删除")
      return
    }
    if (json.job) {
      setCurrent((prev) => (prev?.id === json.job!.id ? json.job! : prev))
      setJobs((list) => [json.job!, ...list.filter((item) => item.id !== json.job!.id)])
    }
    toast.success("已从队列撤下，回到待续")
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
  const pickerWorkflows = workflows.filter((item) => item.picker !== false)
  const hasSteps = Boolean(bundle?.mapping.steps)
  const hasCfg = Boolean(bundle?.mapping.cfg)
  const grouped = groupWorkflows(pickerWorkflows)
  const currentWorkflow = workflows.find((item) => item.name === workflowName)
  const workspaceJob = workspaceJobId
    ? jobs.find((item) => item.id === workspaceJobId) ?? current
    : current
  const shortReadOnly = Boolean(
    shell === "short" && workspaceJob && isWaitingJob(workspaceJob)
  )
  const generateDisabled = shortReadOnly || submitting || !workflowName
  const inWorkspace = shell !== "home"
  const liveJob = workspaceJobId
    ? jobs.find((item) => item.id === workspaceJobId) ?? current
    : current

  const guideBusy = Boolean(liveJob && isBusyJob(liveJob))
  const guide = (
    <PromptGuide
      open={inWorkspace && (guideOpen || guidePinned)}
      pinned={guidePinned}
      compact={guideBusy}
      mode={shell === "long" ? "t2v" : guideMode}
      duration={durationSeconds}
      prompt={prompt}
      textareaRef={textareaRef}
      monitorRef={monitorRef}
      disabled={shell === "short" ? shortReadOnly : guideBusy}
      extraRules={
        shell === "long"
          ? ["下一段先用大约 2 秒接住上一镜的结尾，再开新动作（气闸）。"]
          : undefined
      }
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
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="relative z-20 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-2.5 lg:px-5">
        <h1 className="min-w-0 font-heading text-lg font-semibold tracking-tight text-pretty">
          MiniMax H3 Studio
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {booting ? (
            <Skeleton className="h-8 w-28" />
          ) : (
            <>
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={healthBusy}
                  onClick={() => void retryHealth()}
                >
                  {healthBusy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCwIcon data-icon="inline-start" />
                  )}
                  重试
                </Button>
              ) : null}
            </>
          )}
          <Button type="button" size="sm" variant="ghost" asChild>
            <a href={comfyUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              ComfyUI
            </a>
          </Button>
          <ThemeToggle />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setFocusEnvironment(false)
              setSettingsOpen(true)
            }}
          >
            <Settings2Icon data-icon="inline-start" />
            设置
          </Button>
        </div>
      </header>

      {shell === "home" ? (
        <div
          id="studio-main"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          aria-busy={booting}
        >
          <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-hidden p-4">
            {booting ? (
              <HomeBootSkeleton />
            ) : (
              <>
                {!connected ? (
                  <Alert className="shrink-0">
                    <AlertTitle>还没有连上 ComfyUI</AlertTitle>
                    <AlertDescription>
                      请在本机启动 ComfyUI（默认 8188），然后再生成。Studio
                      不会代装模型，也不会改你的节点图。
                    </AlertDescription>
                  </Alert>
                ) : null}
                {workflows.length === 0 ? (
                  <Empty className="shrink-0 border bg-card/40">
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
                      <Button
                        type="button"
                        onClick={() => {
                          setFocusEnvironment(false)
                          setSettingsOpen(true)
                        }}
                      >
                        打开设置
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      size="lg"
                      className="h-11 w-full"
                      onClick={() => void openNewShort()}
                    >
                      <PlusIcon data-icon="inline-start" />
                      新建短片
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      className="h-11 w-full"
                      onClick={() => void openNewLong()}
                    >
                      <PlusIcon data-icon="inline-start" />
                      新建长视频
                    </Button>
                  </div>
                )}
                <QueuePanel
                  queue={queue}
                  jobs={jobs}
                  onOpen={(job) => void openJob(job)}
                  onResume={() => void resumeQueue()}
                  onWithdraw={(job) => void withdrawQueueItem(job)}
                />
                <TaskList
                  jobs={jobs}
                  currentId={current?.id}
                  onSelect={(job) => void openJob(job)}
                  onDelete={(job) => setDeleteTargets([job])}
                  onDeleteMany={setDeleteTargets}
                />
              </>
            )}
          </section>
        </div>
      ) : (
        <WorkspaceSplit
          left={
          <section className="relative flex h-full min-h-0 min-w-0 flex-col border-b lg:max-h-[calc(100dvh-3.75rem)] lg:border-b-0">
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
              <Button type="button" size="sm" variant="ghost" onClick={goHome}>
                <ArrowLeftIcon data-icon="inline-start" />
                返回列表
              </Button>
              {shell === "long" ? (
                <Badge className="h-6 gap-1 rounded-md px-2.5 font-medium">
                  <ClapperboardIcon data-icon="inline-start" />
                  长视频
                </Badge>
              ) : (
                <Badge
                  variant={workspaceJobId ? "secondary" : "outline"}
                  className="h-6 gap-1 rounded-md px-2.5 font-medium"
                >
                  <FilmIcon data-icon="inline-start" />
                  {workspaceJobId ? "短片" : "新建短片"}
                </Badge>
              )}
              {queue.remaining > 0 ? (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  队列还剩 {queue.remaining}
                </span>
              ) : null}
              {queue.paused &&
              queue.remaining > 0 &&
              liveJob &&
              (isWaitingJob(liveJob) || waitingSegment(liveJob.long)) ? (
                <Button type="button" size="sm" onClick={() => void resumeQueue()}>
                  继续队列（{queue.remaining}）
                </Button>
              ) : null}
              {liveJob && (isWaitingJob(liveJob) || waitingSegment(liveJob.long)) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void withdrawQueueItem(liveJob)}
                >
                  {isLongJob(liveJob) ? "从队列撤下" : "从队列删除"}
                </Button>
              ) : null}
            </div>
            <div className="flex min-h-0 flex-1 overflow-hidden p-3">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
                {shell === "long" && liveJob && isLongJob(liveJob) ? (
                  <LongWorkspace
                    job={liveJob}
                    submitting={submitting}
                    prompt={prompt}
                    textareaRef={textareaRef}
                    onPromptChange={setPrompt}
                    onPromptFocus={() => setGuideOpen(true)}
                    onGenerate={(payload) => void submitLong(payload)}
                    onFinalize={() => void finalizeLong(true)}
                    onReopen={() => void finalizeLong(false)}
                  />
                ) : (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                      <ComposeForm
                        readOnly={shortReadOnly}
                        workflows={pickerWorkflows}
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
                    </div>
                    <div className="flex shrink-0 flex-col gap-3 border-t px-4 py-3">
                      <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
                        {shortReadOnly
                          ? "这条还在队列里，不能改。要从队列撤下后才能改词。"
                          : workspaceJob && isBusyJob(workspaceJob)
                            ? "监视器看着这条。再点生成会排到队列后面，不会改正在跑的。"
                            : workspaceJobId
                              ? "会新开一条短片，不会改列表里这条。"
                              : "生成后会出现在任务列表。"}
                      </p>
                      <Button
                        type="button"
                        size="lg"
                        className="h-11 w-full"
                        disabled={generateDisabled}
                        onClick={() => void submitShort()}
                      >
                        {submitting ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <PlayIcon data-icon="inline-start" />
                        )}
                        {submitting ? "提交中" : "生成"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
          }
          right={
          <section
            ref={(node) => {
              monitorRef.current = node
            }}
            className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-4 lg:max-h-[calc(100dvh-3.75rem)] lg:overflow-hidden"
          >
            <MonitorPanel
              job={liveJob}
              busy={Boolean(liveJob && isBusyJob(liveJob))}
              progressPercent={progressPercent}
              aspect={liveJob?.aspect ?? aspect}
              duration={liveJob ? String(liveJob.duration) : duration}
              mode={monitorMode}
              onModeChange={setMonitorMode}
              onInterrupt={
                liveJob && isBusyJob(liveJob)
                  ? () => {
                      void fetch(`/api/jobs/${liveJob.id}`, { method: "DELETE" })
                    }
                  : undefined
              }
              onRetryStitch={() => void retryStitch()}
              emptyHint={
                shell === "long"
                  ? "写好这一段后生成。监视器默认看当前段，也可切到已拼接。"
                  : "写好提示词后生成。进度走 ComfyUI 的 websocket，成片会复制到 outputs/ 目录。"
              }
            />
          </section>
          }
        />
      )}

      {guide}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open)
          if (!open) setFocusEnvironment(false)
        }}
        port={port}
        comfyUrl={comfyUrl}
        connected={connected}
        workflowName={workflowName}
        workflows={workflows}
        bundle={bundle}
        environmentLine={environmentLine}
        focusEnvironment={focusEnvironment}
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

      <AlertDialog
        open={deleteTargets.length > 0}
        onOpenChange={(open) => {
          if (!open) setDeleteTargets([])
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTargets.length > 1
                ? `删除 ${deleteTargets.length} 条任务？`
                : "删除这条任务？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              会从任务列表拿掉，并删除 outputs 里对应的成片。此操作不能恢复。进行中的任务不会被删。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const targets = deleteTargets
                setDeleteTargets([])
                if (targets.length === 1) void deleteJob(targets[0])
                else void deleteJobs(targets)
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

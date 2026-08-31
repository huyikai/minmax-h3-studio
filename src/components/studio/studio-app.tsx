"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ClapperboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ImagePlusIcon,
  RefreshCwIcon,
  Settings2Icon,
  SquareIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import { SettingsDialog } from "@/components/studio/settings-dialog"
import type { WorkflowBundle } from "@/components/studio/types"
import type { HealthStatus, LoraFormValue, PublicJob } from "@/lib/types"
import { ASPECT_PRESETS, DURATION_OPTIONS } from "@/lib/types"
import { cn } from "@/lib/utils"

const PROMPT_PLACEHOLDER = `先写场景与人物，再按时间写出镜头运动。把对白、环境音和配乐写在同一段里。

例如：
黄昏的海边栈道，一位穿红色风衣的女人面向镜头。
[0s-3s] 中景，海风吹动头发，镜头缓慢前推。
[3s-6s] 切到侧脸特写，她开口说话。
对白：「回来了。」
环境音：浪声、远处海鸥。配乐低而温暖。`

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

export function StudioApp() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [port, setPort] = useState(8188)
  const [comfyUrl, setComfyUrl] = useState("http://127.0.0.1:8188")
  const [workflows, setWorkflows] = useState<string[]>([])
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
  const [firstFrame, setFirstFrame] = useState<File | null>(null)
  const [firstPreview, setFirstPreview] = useState<string | null>(null)
  const frameInputRef = useRef<HTMLInputElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

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
    const json = (await response.json()) as { files: string[] }
    setWorkflows(json.files)
    const next =
      keep && json.files.includes(keep)
        ? keep
        : preferred && json.files.includes(preferred)
          ? preferred
          : (json.files[0] ?? "")
    setWorkflowName(next)
    return { files: json.files, selected: next }
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

  function setFrameFile(file: File | null) {
    setFirstPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return file ? URL.createObjectURL(file) : null
    })
    setFirstFrame(file)
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
      if (steps) form.set("steps", steps)
      if (cfg) form.set("cfg", cfg)
      if (firstFrame) form.set("firstFrame", firstFrame)
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
    if (job.workflowFile) setWorkflowName(job.workflowFile)
  }

  const mappingHints = bundle
    ? [
        bundle.mapping.prompt ? "提示词" : null,
        bundle.mapping.firstFrame ? "首帧" : null,
        bundle.mapping.duration ? "时长" : null,
        bundle.mapping.seed ? "seed" : null,
        bundle.mapping.loras.length ? `LoRA ×${bundle.mapping.loras.length}` : null,
      ].filter(Boolean)
    : []

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <ClapperboardIcon />
          </div>
          <div>
            <h1 className="font-heading text-base font-medium">MiniMax H3 Studio</h1>
            <p className="text-sm text-muted-foreground">
              本地出片，底层走你已经跑通的 ComfyUI 工作流
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "secondary" : "destructive"}>
            {connected
              ? health?.queueRemaining
                ? `已连接 · 队列 ${health.queueRemaining}`
                : "已连接"
              : "未连接 ComfyUI"}
          </Badge>
          <Button type="button" size="sm" variant="outline" onClick={() => void loadHealth()}>
            <RefreshCwIcon data-icon="inline-start" />
            重试连接
          </Button>
          <Button type="button" size="sm" variant="outline" asChild>
            <a href={comfyUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              打开 ComfyUI
            </a>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2Icon data-icon="inline-start" />
            设置
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(22rem,28rem)_1fr]">
        <section className="flex min-h-0 flex-col gap-5 border-b p-4 lg:border-r lg:border-b-0">
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
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClapperboardIcon />
                </EmptyMedia>
                <EmptyTitle>先导入一份 API 工作流</EmptyTitle>
                <EmptyDescription>
                  在 ComfyUI 打开你已经跑通的 MiniMax H3 图，使用「文件 →
                  导出（API）」，把 JSON 放到 workflows/ 或在设置里上传。
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
                <FieldLabel>工作流</FieldLabel>
                <Select
                  value={workflowName}
                  onValueChange={(name) => {
                    setWorkflowName(name)
                    void loadBundle(name)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择 JSON" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {workflows.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {mappingHints.length
                    ? `已识别：${mappingHints.join("、")}`
                    : "未识别到常用字段，请到设置里手动映射"}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="prompt">提示词</FieldLabel>
                <Textarea
                  id="prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={PROMPT_PLACEHOLDER}
                  className="min-h-48"
                />
              </Field>

              <Field>
                <FieldLabel>首帧（可选）</FieldLabel>
                <div
                  className={cn(
                    "flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center",
                    firstPreview && "items-stretch"
                  )}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const file = event.dataTransfer.files[0]
                    if (file?.type.startsWith("image/")) setFrameFile(file)
                  }}
                  onPaste={(event) => {
                    const file = [...event.clipboardData.files][0]
                    if (file?.type.startsWith("image/")) setFrameFile(file)
                  }}
                >
                  {firstPreview ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={firstPreview}
                        alt="首帧预览"
                        className="max-h-48 w-full rounded-lg object-contain"
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="secondary"
                        className="absolute top-2 right-2"
                        onClick={() => setFrameFile(null)}
                      >
                        <XIcon />
                        <span className="sr-only">移除首帧</span>
                      </Button>
                    </div>
                  ) : (
                    <>
                      <ImagePlusIcon />
                      <p className="text-sm text-muted-foreground">
                        拖入、粘贴或选择一张图。不放图则按文生视频提交。
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => frameInputRef.current?.click()}
                      >
                        选择图片
                      </Button>
                    </>
                  )}
                  <input
                    ref={frameInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ""
                      if (file) setFrameFile(file)
                    }}
                  />
                </div>
                {firstFrame && !bundle?.mapping.firstFrame ? (
                  <FieldDescription>
                    当前工作流没有首帧映射，生成时会报错。请换 I2V 图或到设置里指定 LoadImage。
                  </FieldDescription>
                ) : null}
              </Field>

              <Field>
                <FieldLabel>时长</FieldLabel>
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
                    <ToggleGroupItem key={item} value={String(item)}>
                      {item}s
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              <Field>
                <FieldLabel>画幅</FieldLabel>
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
                    <ToggleGroupItem key={item.id} value={item.id}>
                      {item.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              <Field>
                <FieldLabel htmlFor="seed">Seed</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="seed"
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

              {loras.length > 0 ? (
                <FieldGroup>
                  {loras.map((lora, index) => (
                    <Field key={`${lora.nodeId}-${index}`}>
                      <FieldLabel>LoRA {index + 1}</FieldLabel>
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
                      <FieldDescription>强度 {lora.strength.toFixed(2)}</FieldDescription>
                    </Field>
                  ))}
                </FieldGroup>
              ) : null}

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="sm">
                    高级：步数 / CFG
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel htmlFor="steps">步数</FieldLabel>
                      <Input
                        id="steps"
                        value={steps}
                        onChange={(event) => setSteps(event.target.value)}
                        placeholder="工作流默认"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="cfg">CFG</FieldLabel>
                      <Input
                        id="cfg"
                        value={cfg}
                        onChange={(event) => setCfg(event.target.value)}
                        placeholder="工作流默认"
                      />
                    </Field>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex gap-2">
                <Button
                  type="button"
                  className="flex-1"
                  disabled={busy || submitting || !workflowName}
                  onClick={() => void submit(false)}
                >
                  {submitting || busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <WandSparklesIcon data-icon="inline-start" />
                  )}
                  {busy ? "生成中" : "生成"}
                </Button>
                {busy ? (
                  <Button
                    type="button"
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
            </FieldGroup>
          )}
        </section>

        <section className="flex min-h-0 flex-col gap-4 p-4">
          <div className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
            {current?.outputUrl && current.status === "success" ? (
              <video
                key={current.outputUrl}
                className="max-h-[28rem] w-full flex-1 bg-black object-contain"
                src={current.outputUrl}
                controls
                autoPlay
              />
            ) : busy ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
                <Spinner />
                <p className="text-sm text-muted-foreground">
                  {current?.progress?.nodeTitle ||
                    (current?.progress?.node
                      ? `节点 ${current.progress.node}`
                      : "已提交，等待 ComfyUI…")}
                </p>
                <div className="w-full max-w-md">
                  <Progress value={progressPercent} />
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    {current?.progress?.max
                      ? `${current.progress.value} / ${current.progress.max}`
                      : "排队或加载模型中"}
                  </p>
                </div>
              </div>
            ) : current?.status === "error" ? (
              <div className="flex flex-1 items-center p-6">
                <Alert variant="destructive">
                  <AlertTitle>生成失败</AlertTitle>
                  <AlertDescription>{current.error}</AlertDescription>
                </Alert>
              </div>
            ) : (
              <Empty className="flex-1">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ClapperboardIcon />
                  </EmptyMedia>
                  <EmptyTitle>还没有成片</EmptyTitle>
                  <EmptyDescription>
                    写好提示词后点生成。进度走 ComfyUI 的 websocket，成片会复制到
                    outputs/ 目录。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {current ? (
              <div className="flex flex-wrap items-center gap-2 border-t p-3">
                <Badge variant="secondary">{statusLabel(current)}</Badge>
                <span className="text-sm text-muted-foreground">
                  {current.workflowFile} · {current.duration}s · {current.aspect} · seed{" "}
                  {current.seed}
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
                  <Button size="sm" variant="outline" asChild>
                    <a href={current.workflowUrl} download>
                      本次 JSON
                    </a>
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-48 flex-col rounded-xl border">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-sm font-medium">历史</h2>
              <span className="text-xs text-muted-foreground">
                点一条即可回填表单再出
              </span>
            </div>
            <Separator />
            {jobs.length === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyTitle>没有记录</EmptyTitle>
                  <EmptyDescription>
                    第一次生成成功后，提示词、参数和成片会留在这里。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ScrollArea className="h-56">
                <ul className="flex flex-col gap-1 p-2">
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted",
                          current?.id === job.id && "bg-muted"
                        )}
                        onClick={() => fillFromJob(job)}
                      >
                        <Badge variant="secondary">{statusLabel(job)}</Badge>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm">{job.prompt || "（无提示词）"}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(job.createdAt).toLocaleString("zh-CN")} ·{" "}
                            {job.duration}s · {job.aspect}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        </section>
      </div>

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
          const json = (await response.json()) as { error?: string }
          if (!response.ok) throw new Error(json.error ?? "删除失败")
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

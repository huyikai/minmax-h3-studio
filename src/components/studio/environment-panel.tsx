"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LabelWithHelp } from "@/components/studio/field-help"
import { H3_UNET_PRECISION, formatBytes } from "@/lib/h3-models"
import type { EnvironmentLine, EnvironmentStatus } from "@/lib/environment-types"
import type { H3UnetPrecision } from "@/lib/types"

async function postAction(body: Record<string, unknown>) {
  const response = await fetch("/api/environment/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = (await response.json()) as EnvironmentStatus & { error?: string }
  if (!response.ok) {
    throw new Error(json.error ?? "操作失败")
  }
  return json
}

export function EnvironmentPanel({
  line,
  onLineReady,
}: {
  line: EnvironmentLine
  onLineReady?: (ready: boolean) => void
}) {
  const [status, setStatus] = useState<EnvironmentStatus | null>(null)
  const [root, setRoot] = useState("")
  const [extraDir, setExtraDir] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/environment?line=${encodeURIComponent(line)}`)
      .then(async (response) => {
        const json = (await response.json()) as EnvironmentStatus
        if (cancelled) return
        setStatus(json)
        setRoot(json.comfyRoot.path)
        setExtraDir(json.extraModelsDir)
        onLineReady?.(json.ready)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "无法读取环境")
        }
      })
    return () => {
      cancelled = true
    }
  }, [line, onLineReady])

  const downloading = Boolean(
    status?.downloads.some(
      (item) => item.status === "downloading" || item.status === "queued"
    )
  )

  useEffect(() => {
    if (!downloading) return
    const timer = setInterval(() => {
      void fetch(`/api/environment?line=${encodeURIComponent(line)}`)
        .then(async (response) => {
          const json = (await response.json()) as EnvironmentStatus
          setStatus(json)
          setRoot(json.comfyRoot.path)
          setExtraDir(json.extraModelsDir)
          onLineReady?.(json.ready)
        })
        .catch(() => {
          // keep last status
        })
    }, 1500)
    return () => clearInterval(timer)
  }, [downloading, line, onLineReady])

  async function run(action: string, extra?: Record<string, unknown>) {
    setBusy(true)
    try {
      const json = await postAction({ action, line, ...extra })
      setStatus(json)
      setRoot(json.comfyRoot.path)
      setExtraDir(json.extraModelsDir)
      onLineReady?.(json.ready)
      if (
        action === "auto_fix" ||
        action === "install_motion_context" ||
        action === "write_extra_paths" ||
        action === "save_root"
      ) {
        toast.success(json.summary)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败")
      const response = await fetch(`/api/environment?line=${encodeURIComponent(line)}`)
      const json = (await response.json()) as EnvironmentStatus
      setStatus(json)
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return <p className="text-sm text-muted-foreground">正在检查环境…</p>
  }

  const autoAvailable = status.gaps.some((item) => item.auto)

  return (
    <FieldGroup id="studio-environment">
      {status.mock ? (
        <Alert>
          <AlertTitle>当前是假 Comfy</AlertTitle>
          <AlertDescription>
            节点和模型都是假装就绪，方便调界面。不会下载权重，也不会复制自定义节点。
          </AlertDescription>
        </Alert>
      ) : null}

      {status.gaps.length > 0 && !status.mock ? (
        <Alert variant={status.ready ? "default" : "destructive"}>
          <AlertTitle>{status.summary}</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
              {status.gaps.map((gap) => (
                <li key={gap.id}>
                  {gap.title}
                  {gap.detail ? ` ${gap.detail}` : ""}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Field>
        <LabelWithHelp htmlFor="comfy-root" label="ComfyUI 根目录">
          要装自定义节点、下载模型，必须先填对这个目录。不要选 .app。填完会校验有没有可写的 custom_nodes。
        </LabelWithHelp>
        <div className="flex gap-2">
          <Input
            id="comfy-root"
            value={root}
            onChange={(event) => setRoot(event.target.value)}
            placeholder="/path/to/ComfyUI"
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run("save_root", { comfyRoot: root })}
          >
            校验
          </Button>
        </div>
        <FieldDescription>
          {status.comfyRoot.ok
            ? `已识别 custom_nodes：${status.comfyRoot.customNodes}`
            : status.comfyRoot.error ?? "还没有通过校验。"}
          {status.comfyRoot.candidates.length > 0 ? (
            <>
              {" "}
              本机候选：
              {status.comfyRoot.candidates.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="ml-1 underline"
                  onClick={() => setRoot(item)}
                >
                  {item}
                </button>
              ))}
            </>
          ) : null}
        </FieldDescription>
      </Field>

      <Field>
        <LabelWithHelp label="H3 权重档（unet_name）">
          {status.unetHelp} 这只改 FL2VA 短片和长视频。参考生仍用工作流里的 Ref2VA 文件名。
        </LabelWithHelp>
        <Select
          value={status.precision}
          onValueChange={(value) => {
            if (value === status.precision) return
            void run("save_precision", { precision: value as H3UnetPrecision })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(Object.keys(H3_UNET_PRECISION) as H3UnetPrecision[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {H3_UNET_PRECISION[key].label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription className="font-mono text-[11px]">
          unet_name = {status.unetName}
        </FieldDescription>
      </Field>

      <Field>
        <LabelWithHelp label="当前这条线需要的模型">
          先看 Comfy 已经认得的文件名。没有的可以下到默认 models 目录，或登记你已经下好的目录。
        </LabelWithHelp>
        <ul className="flex flex-col gap-1 text-sm">
          {status.models.map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-[11px]">
                {item.filename}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {item.present ? "已识别" : formatBytes(item.bytes)}
              </span>
            </li>
          ))}
        </ul>
        {!status.disk.ok ? (
          <FieldDescription>
            磁盘不够。还需要大约 {formatBytes(status.disk.need)}，可用{" "}
            {formatBytes(status.disk.free)}。
          </FieldDescription>
        ) : null}
      </Field>

      {status.downloads.length > 0 ? (
        <Field>
          <LabelWithHelp label="下载进度">未完成的文件用临时名，下完再改成 .safetensors。</LabelWithHelp>
          <div className="flex flex-col gap-2">
            {status.downloads.map((item) => {
              const percent =
                item.total > 0 ? Math.min(100, Math.round((item.bytes / item.total) * 100)) : 0
              return (
                <div key={item.id} className="flex flex-col gap-1">
                  <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                    <span className="truncate">{item.filename}</span>
                    <span>
                      {item.status === "complete"
                        ? "完成"
                        : `${formatBytes(item.bytes)} / ${formatBytes(item.total)}`}
                    </span>
                  </div>
                  <Progress value={percent} />
                  {item.error ? (
                    <p className="text-xs text-destructive">{item.error}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Field>
      ) : null}

      <Field>
        <LabelWithHelp htmlFor="extra-models" label="已有模型目录（可选）">
          模型已经在别的盘时填这里。必须带 diffusion_models / text_encoders / vae 子目录。Studio 只追加 yaml 里的 h3_studio 段，并先备份。
        </LabelWithHelp>
        <div className="flex gap-2">
          <Input
            id="extra-models"
            value={extraDir}
            onChange={(event) => setExtraDir(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run("save_extra_dir", { extraModelsDir: extraDir })}
          >
            校验目录
          </Button>
        </div>
        {status.extraDirError ? (
          <FieldDescription>{status.extraDirError}</FieldDescription>
        ) : null}
        {status.extraPathsPreview ? (
          <pre className="mt-2 max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">
            {status.extraPathsPreview}
          </pre>
        ) : null}
        {status.extraDirOk && !status.extraPathsWritten ? (
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={busy || status.mock}
            onClick={() => void run("write_extra_paths")}
          >
            确认写入 extra_model_paths
          </Button>
        ) : null}
        {status.extraPathsWritten ? (
          <FieldDescription>h3_studio 段已写入。请重启 ComfyUI 后再检测。</FieldDescription>
        ) : null}
      </Field>

      <Field>
        <LabelWithHelp htmlFor="hf-token" label="Hugging Face token（可选）">
          下载限流或失败时再填。不会显示已保存的内容。
        </LabelWithHelp>
        <div className="flex gap-2">
          <Input
            id="hf-token"
            type="password"
            value={token}
            placeholder={status.hfTokenSet ? "已保存，留空则不改" : ""}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !token.trim()}
            onClick={() => void run("save_hf_token", { hfToken: token })}
          >
            保存
          </Button>
        </div>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || status.mock || !autoAvailable}
          onClick={() => void run("auto_fix")}
        >
          按能自动的去补
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void run("redetect")}
        >
          重新检测
        </Button>
        {line === "long" && !status.mock ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy || !status.comfyRoot.ok || status.motionContext.onDisk}
            onClick={() => void run("install_motion_context")}
          >
            {status.motionContext.onDisk ? "Motion Context 已在磁盘" : "复制 Motion Context"}
          </Button>
        ) : null}
      </div>
      {status.restartNeeded ||
      (status.motionContext.onDisk && !status.motionContext.inComfy && line === "long") ? (
        <p className="text-sm text-muted-foreground">
          请重启 ComfyUI，再点「重新检测」。Studio 不会替你关掉正在跑的 Comfy。
        </p>
      ) : null}
    </FieldGroup>
  )
}

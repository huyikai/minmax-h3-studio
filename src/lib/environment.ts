import fs from "node:fs/promises"
import path from "node:path"
import {
  getHealth,
  hasNodeClass,
  isMockComfy,
  listModelFolder,
} from "@/lib/comfy"
import { validateComfyRoot, type ComfyLayout } from "@/lib/comfy-root"
import { bundledWorkflow, longWorkflowCapabilities } from "@/lib/default-workflows"
import type { EnvironmentGap, EnvironmentLine, EnvironmentStatus, ModelRow } from "@/lib/environment-types"
import {
  extraDirHasFile,
  extraPathsAlreadyWritten,
  extraPathsBlock,
  validateExtraModelsDir,
} from "@/lib/extra-model-paths"
import {
  COMFY_MIN_H3,
  FIXED_MODELS,
  H3_UNET_PRECISION,
  TURBO_LORA_NAME,
  TURBO_NODE_CLASSES,
  TURBO_PACK_URL,
  fl2vaFile,
  formatBytes,
  ref2vaFile,
  type CatalogFile,
} from "@/lib/h3-models"
import { MOTION_CONTEXT_COMFY_MIN } from "@/lib/long-video"
import { listDownloads } from "@/lib/model-download"
import { motionContextOnDisk } from "@/lib/motion-context-install"
import { dataDir } from "@/lib/paths"
import { readSettings } from "@/lib/settings"
import type { JobKind } from "@/lib/types"

export type { EnvironmentLine, EnvironmentStatus } from "@/lib/environment-types"

type Flags = {
  restartMotion?: boolean
  restartExtra?: boolean
}

function flagsPath() {
  return path.join(dataDir(), "environment-flags.json")
}

export async function readFlags(): Promise<Flags> {
  try {
    return JSON.parse(await fs.readFile(flagsPath(), "utf8")) as Flags
  } catch {
    return {}
  }
}

export async function writeFlags(next: Flags) {
  await fs.mkdir(dataDir(), { recursive: true })
  await fs.writeFile(flagsPath(), `${JSON.stringify(next, null, 2)}\n`)
}

export function environmentLineFor(workflowFile: string, kind?: JobKind): EnvironmentLine {
  if (kind === "long") return "long"
  const family = bundledWorkflow(workflowFile)?.family
  if (family === "turbo") return "turbo"
  if (family === "reference") return "reference"
  if (family === "long") return "long"
  return "short"
}

function basenameMatch(listed: string[], filename: string) {
  return listed.some((item) => item === filename || item.endsWith(`/${filename}`))
}

async function filePresent(args: {
  listed: string[]
  file: CatalogFile
  layout?: ComfyLayout
  extraDir?: string
}) {
  if (basenameMatch(args.listed, args.file.filename)) return true
  if (args.layout) {
    try {
      await fs.access(path.join(args.layout.models, args.file.folder, args.file.filename))
      return true
    } catch {
      // continue
    }
  }
  if (args.extraDir) {
    return extraDirHasFile(args.extraDir, args.file.folder, args.file.filename)
  }
  return false
}

async function diskFree(target?: string) {
  if (!target) return 0
  try {
    await fs.mkdir(target, { recursive: true })
    const stat = await fs.statfs(target)
    return Number(stat.bavail) * Number(stat.bsize)
  } catch {
    return 0
  }
}

export async function evaluateEnvironment(line: EnvironmentLine): Promise<EnvironmentStatus> {
  const settings = await readSettings()
  const health = await getHealth()
  const mock = health.ok ? await isMockComfy() : false
  const connected = mock || health.ok
  const h3NodeOk = mock || (await hasNodeClass("MiniMaxH3ImageToVideo"))
  const motionInComfy = mock || (await hasNodeClass("MiniMaxH3MotionContext"))
  const root = await validateComfyRoot(settings.comfyRoot)
  const layout = root.ok ? root.layout : undefined
  const extraCheck = settings.extraModelsDir
    ? await validateExtraModelsDir(settings.extraModelsDir)
    : { ok: false as const, error: undefined as string | undefined }
  const extraDir = extraCheck.ok ? extraCheck.path : ""
  const extraWritten = Boolean(
    layout && extraDir && (await extraPathsAlreadyWritten(layout.extraYaml, extraDir))
  )
  const flags = await readFlags()
  const onDisk = mock ? true : await motionContextOnDisk(layout)

  const listed = {
    diffusion_models: mock
      ? [
          ...Object.values(H3_UNET_PRECISION).map((item) => item.fl2va),
          ...Object.values(H3_UNET_PRECISION).map((item) => item.ref2va),
        ]
      : await listModelFolder("diffusion_models"),
    text_encoders: mock
      ? [FIXED_MODELS.clip.filename]
      : await listModelFolder("text_encoders"),
    vae: mock
      ? [FIXED_MODELS.videoVae.filename, FIXED_MODELS.audioVae.filename]
      : await listModelFolder("vae"),
    loras: mock ? [TURBO_LORA_NAME] : await listModelFolder("loras"),
  }

  const precision = settings.h3UnetPrecision
  const unet = fl2vaFile(precision)
  const ref = ref2vaFile(precision)
  const requiredFiles: CatalogFile[] = [
    unet,
    FIXED_MODELS.clip,
    FIXED_MODELS.videoVae,
    FIXED_MODELS.audioVae,
  ]
  if (line === "reference") requiredFiles.push(ref)

  const models: ModelRow[] = []
  for (const file of requiredFiles) {
    const present = mock
      ? true
      : await filePresent({
          listed: listed[file.folder],
          file,
          layout,
          extraDir: extraDir || undefined,
        })
    models.push({ ...file, present, required: true })
  }

  const turboNodeOk =
    mock ||
    ((await hasNodeClass(TURBO_NODE_CLASSES[0])) &&
      (await hasNodeClass(TURBO_NODE_CLASSES[1])))
  const turboLoraOk = mock || basenameMatch(listed.loras, TURBO_LORA_NAME)
  const refNodeOk = mock || (await hasNodeClass("MiniMaxH3ReferenceToVideo"))

  const restartNeeded = Boolean(
    !mock && (flags.restartMotion || flags.restartExtra) && (!motionInComfy || flags.restartExtra)
  )

  const missingModels = models.filter((item) => !item.present)
  const needBytes = missingModels.reduce((sum, item) => sum + item.bytes, 0)
  const free = await diskFree(layout?.models)
  const diskOk = needBytes === 0 || free === 0 || free > needBytes + 1_000_000_000

  const gaps: EnvironmentGap[] = []
  if (!mock && !connected) {
    gaps.push({
      id: "connected",
      title: "还没有连上 ComfyUI",
      detail: `当前 127.0.0.1:${settings.comfyPort} 没有响应。Studio 不代装 Comfy。请先安装并启动带 MiniMax H3 的 ComfyUI，再点重新检测。说明：https://docs.comfy.org/zh/tutorials/video/minimax/minimax-h3`,
      auto: false,
    })
  }

  if (!mock && connected && !h3NodeOk) {
    gaps.push({
      id: "h3-node",
      title: "当前 ComfyUI 还没有 MiniMax H3 节点",
      detail: `短片用的 MiniMaxH3ImageToVideo 是 Comfy 自带的，不能靠复制自定义节点补上。请升级到含 H3 的版本（≥ ${COMFY_MIN_H3}）。`,
      auto: false,
    })
  }

  if (!mock && line === "reference" && connected && !refNodeOk) {
    gaps.push({
      id: "ref-node",
      title: "没有参考生节点",
      detail: "MiniMaxH3ReferenceToVideo 也是 Comfy 自带节点，请升级 ComfyUI。",
      auto: false,
    })
  }

  if (!mock && line === "long") {
    if (!onDisk && !root.ok) {
      gaps.push({
        id: "mc-root",
        title: "还不能安装 Motion Context",
        detail: root.error ?? "先填对 ComfyUI 根目录，才能把节点复制进 custom_nodes。",
        auto: false,
      })
    } else if (!onDisk) {
      gaps.push({
        id: "mc-copy",
        title: "还没有 Motion Context 节点文件",
        detail: "Studio 会把内置源码复制到 custom_nodes。复制后请重启 ComfyUI。",
        auto: Boolean(root.ok),
      })
    } else if (!motionInComfy) {
      gaps.push({
        id: "mc-restart",
        title: "Motion Context 已在磁盘上，Comfy 还没认出",
        detail: `请重启 ComfyUI（≥ ${MOTION_CONTEXT_COMFY_MIN}），再点重新检测。`,
        auto: false,
      })
    }
  }

  if (!mock && line === "turbo") {
    if (!turboNodeOk) {
      gaps.push({
        id: "turbo-node",
        title: "还没有 Turbo 自定义节点",
        detail: `这轮 Studio 不代装。请自行安装 ${TURBO_PACK_URL} 后重启 ComfyUI。`,
        auto: false,
      })
    }
    if (!turboLoraOk) {
      gaps.push({
        id: "turbo-lora",
        title: "还没有 Turbo LoRA",
        detail: `工作流需要 ${TURBO_LORA_NAME}。请放到 Comfy 的 loras 目录。`,
        auto: false,
      })
    }
  }

  if (!mock && missingModels.length) {
    gaps.push({
      id: "models",
      title: `还缺 ${missingModels.length} 份模型`,
      detail: missingModels
        .map((item) => `${item.filename}（${formatBytes(item.bytes)}）`)
        .join("；"),
      auto: Boolean(layout),
    })
  }

  if (!mock && extraDir && !extraWritten && extraCheck.ok) {
    gaps.push({
      id: "extra-paths",
      title: "已有模型目录还没登记到 Comfy",
      detail: "确认预览后写入 extra_model_paths.yaml 的 h3_studio 段，然后重启 ComfyUI。",
      auto: false,
    })
  }

  if (!mock && restartNeeded && !gaps.some((item) => item.id === "mc-restart")) {
    gaps.push({
      id: "restart",
      title: "需要重启 ComfyUI",
      detail: "刚复制了节点或改了模型搜索路径。请重启 ComfyUI，再点重新检测。",
      auto: false,
    })
  }

  const ready = mock || (connected && h3NodeOk && gaps.length === 0)
  const summary = mock
    ? "当前是假 Comfy，节点和模型都是假装就绪，不会真下、也不会复制节点。"
    : ready
      ? "当前这条线可以生成。"
      : gaps[0]?.title ?? "环境还没就绪"

  return {
    ready,
    mock,
    line,
    connected: mock || connected,
    comfyHost: settings.comfyHost,
    comfyPort: settings.comfyPort,
    comfyMin: COMFY_MIN_H3,
    h3NodeOk,
    motionContext: { onDisk, inComfy: motionInComfy },
    comfyRoot: {
      path: settings.comfyRoot,
      ok: Boolean(root.ok),
      customNodes: layout?.customNodes,
      models: layout?.models,
      extraYaml: layout?.extraYaml,
      error: root.error,
      candidates: root.candidates,
    },
    extraModelsDir: settings.extraModelsDir,
    extraPathsPreview: extraDir ? extraPathsBlock(extraDir) : null,
    extraPathsWritten: extraWritten,
    extraDirOk: extraCheck.ok === true,
    extraDirError: extraCheck.ok ? undefined : extraCheck.error,
    precision,
    unetName: unet.filename,
    unetHelp: H3_UNET_PRECISION[precision].help,
    models,
    downloads: listDownloads(),
    gaps,
    restartNeeded,
    disk: { free, need: needBytes, ok: diskOk },
    hfTokenSet: Boolean(settings.hfToken),
    summary,
  }
}

export async function evaluateLongWorkflowEnvironment(workflowFile: string) {
  const longEnv = await evaluateEnvironment("long")
  const capabilities = longWorkflowCapabilities(workflowFile)
  if (capabilities?.kind !== "r2v") return longEnv
  const refEnv = await evaluateEnvironment("reference")
  const gaps = [...longEnv.gaps]
  for (const gap of refEnv.gaps) {
    if (!gaps.some((item) => item.id === gap.id)) gaps.push(gap)
  }
  const models = [...longEnv.models]
  for (const model of refEnv.models) {
    if (!models.some((item) => item.id === model.id)) models.push(model)
  }
  const ready = longEnv.ready && refEnv.ready
  return {
    ...longEnv,
    models,
    gaps,
    ready,
    summary: ready ? longEnv.summary : (gaps[0]?.title ?? refEnv.summary),
  }
}

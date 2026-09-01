import path from "node:path"
import { evaluateEnvironment, readFlags, writeFlags, type EnvironmentLine } from "@/lib/environment"
import { validateComfyRoot } from "@/lib/comfy-root"
import { writeExtraModelPaths, validateExtraModelsDir } from "@/lib/extra-model-paths"
import { installMotionContext } from "@/lib/motion-context-install"
import { enqueueDownloads } from "@/lib/model-download"
import { formatBytes, isH3UnetPrecision } from "@/lib/h3-models"
import { isMockComfy } from "@/lib/comfy"
import { readSettings, writeSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

type Body = {
  action?: string
  line?: EnvironmentLine
  comfyRoot?: string
  extraModelsDir?: string
  precision?: string
  hfToken?: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body
  const action = String(body.action ?? "")
  const line: EnvironmentLine =
    body.line === "long" || body.line === "turbo" || body.line === "reference"
      ? body.line
      : "short"

  if (action === "redetect") {
    const flags = await readFlags()
    const status = await evaluateEnvironment(line)
    if (status.motionContext.inComfy) flags.restartMotion = false
    if (status.models.every((item) => item.present) || status.mock) {
      flags.restartExtra = false
    }
    await writeFlags(flags)
    return Response.json(await evaluateEnvironment(line))
  }

  if (await isMockComfy()) {
    if (action === "save_precision" || action === "save_root" || action === "save_extra_dir" || action === "save_hf_token") {
      // allow saving settings even on mock
    } else if (action !== "redetect") {
      return Response.json(
        { error: "当前是假 Comfy，不会安装节点或下载模型。" },
        { status: 400 }
      )
    }
  }

  const settings = await readSettings()

  if (action === "save_root") {
    const check = await validateComfyRoot(String(body.comfyRoot ?? ""))
    await writeSettings({ ...settings, comfyRoot: String(body.comfyRoot ?? "").trim() })
    if (!check.ok) {
      return Response.json(
        { error: check.error, environment: await evaluateEnvironment(line) },
        { status: 400 }
      )
    }
    return Response.json(await evaluateEnvironment(line))
  }

  if (action === "save_extra_dir") {
    const dir = String(body.extraModelsDir ?? "").trim()
    if (dir) {
      const check = await validateExtraModelsDir(dir)
      if (!check.ok) {
        return Response.json({ error: check.error }, { status: 400 })
      }
    }
    await writeSettings({ ...settings, extraModelsDir: dir })
    return Response.json(await evaluateEnvironment(line))
  }

  if (action === "save_precision") {
    const precision = String(body.precision ?? "")
    if (!isH3UnetPrecision(precision)) {
      return Response.json({ error: "不支持的权重档" }, { status: 400 })
    }
    await writeSettings({ ...settings, h3UnetPrecision: precision })
    return Response.json(await evaluateEnvironment(line))
  }

  if (action === "save_hf_token") {
    await writeSettings({ ...settings, hfToken: String(body.hfToken ?? "").trim() })
    return Response.json(await evaluateEnvironment(line))
  }

  if (action === "write_extra_paths") {
    const check = await validateComfyRoot(settings.comfyRoot)
    if (!check.ok || !check.layout) {
      return Response.json({ error: check.error ?? "先填对 ComfyUI 根目录" }, { status: 400 })
    }
    const extra = await validateExtraModelsDir(settings.extraModelsDir)
    if (!extra.ok) {
      return Response.json({ error: extra.error }, { status: 400 })
    }
    const written = await writeExtraModelPaths(check.layout, extra.path)
    const flags = await readFlags()
    flags.restartExtra = true
    await writeFlags(flags)
    return Response.json({
      ...(await evaluateEnvironment(line)),
      wrote: written,
    })
  }

  if (action === "install_motion_context" || action === "auto_fix") {
    const check = await validateComfyRoot(settings.comfyRoot)
    if (!check.ok || !check.layout) {
      return Response.json(
        { error: check.error ?? "先填对 ComfyUI 根目录" },
        { status: 400 }
      )
    }

    if (action === "install_motion_context" || line === "long") {
      const installed = await installMotionContext(check.layout)
      if (installed.copied) {
        const flags = await readFlags()
        flags.restartMotion = true
        await writeFlags(flags)
      }
    }

    if (action === "auto_fix") {
      const status = await evaluateEnvironment(line)
      if (!status.disk.ok) {
        const short = status.disk.need - status.disk.free
        return Response.json(
          {
            error: `磁盘空间不够。还需要大约 ${formatBytes(Math.max(0, short))}。`,
            environment: status,
          },
          { status: 400 }
        )
      }
      const missing = status.models.filter((item) => !item.present)
      if (missing.length) {
        await enqueueDownloads(missing, (file) =>
          path.join(check.layout!.models, file.folder, file.filename)
        )
      }
    }

    return Response.json(await evaluateEnvironment(line))
  }

  return Response.json({ error: "未知操作" }, { status: 400 })
}

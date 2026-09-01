import { readSettings, writeSettings } from "@/lib/settings"
import { comfyBaseUrl } from "@/lib/comfy"
import type { Settings } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET() {
  const settings = await readSettings()
  const { http } = await comfyBaseUrl()
  const { hfToken: _token, ...safe } = settings
  return Response.json({
    ...safe,
    comfyUrl: http,
    hfTokenSet: Boolean(settings.hfToken),
  })
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<Settings>
  const current = await readSettings()
  const port = Number(body.comfyPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Response.json({ error: "端口必须是 1-65535 的整数" }, { status: 400 })
  }
  const next = await writeSettings({
    ...current,
    comfyPort: port,
    defaultWorkflow:
      body.defaultWorkflow === undefined
        ? current.defaultWorkflow
        : body.defaultWorkflow,
    mappings: body.mappings ?? current.mappings,
    comfyRoot:
      body.comfyRoot === undefined ? current.comfyRoot : String(body.comfyRoot),
    extraModelsDir:
      body.extraModelsDir === undefined
        ? current.extraModelsDir
        : String(body.extraModelsDir),
    h3UnetPrecision:
      body.h3UnetPrecision === undefined
        ? current.h3UnetPrecision
        : body.h3UnetPrecision,
    hfToken: body.hfToken === undefined ? current.hfToken : String(body.hfToken),
  })
  const { hfToken: _token, ...safe } = next
  return Response.json({ ...safe, hfTokenSet: Boolean(next.hfToken) })
}

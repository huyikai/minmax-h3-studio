import { readSettings, writeSettings } from "@/lib/settings"
import { comfyBaseUrl } from "@/lib/comfy"
import type { Settings } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET() {
  const settings = await readSettings()
  const { http } = await comfyBaseUrl()
  return Response.json({
    ...settings,
    comfyUrl: http,
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
  })
  return Response.json(next)
}

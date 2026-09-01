import { readWorkflowBundle, readWorkflowFile, removeWorkflow, saveMappingOverrides } from "@/lib/workflow-service"
import type { MappingOverrides } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  context: RouteContext<"/api/workflows/[name]">
) {
  const { name } = await context.params
  const decoded = decodeURIComponent(name)
  const raw = new URL(request.url).searchParams.get("raw") === "1"
  try {
    if (raw) {
      const { filename, data } = await readWorkflowFile(decoded)
      return new Response(`${JSON.stringify(data, null, 2)}\n`, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      })
    }
    const bundle = await readWorkflowBundle(decoded)
    return Response.json(bundle)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "读取失败" },
      { status: 404 }
    )
  }
}

export async function PUT(
  request: Request,
  context: RouteContext<"/api/workflows/[name]">
) {
  const { name } = await context.params
  const body = (await request.json()) as { overrides?: MappingOverrides }
  try {
    const bundle = await saveMappingOverrides(
      decodeURIComponent(name),
      body.overrides ?? {}
    )
    return Response.json(bundle)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "保存映射失败" },
      { status: 400 }
    )
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/workflows/[name]">
) {
  const { name } = await context.params
  try {
    const result = await removeWorkflow(decodeURIComponent(name))
    return Response.json({ ok: true, restored: result.restored })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 400 }
    )
  }
}

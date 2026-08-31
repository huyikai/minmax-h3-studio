import { readWorkflowBundle, removeWorkflow, saveMappingOverrides } from "@/lib/workflow-service"
import type { MappingOverrides } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: RouteContext<"/api/workflows/[name]">
) {
  const { name } = await context.params
  try {
    const bundle = await readWorkflowBundle(decodeURIComponent(name))
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

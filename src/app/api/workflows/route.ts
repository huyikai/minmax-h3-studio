import {
  listWorkflowEntries,
  parseAndSaveWorkflow,
  readWorkflowBundle,
} from "@/lib/workflow-service"

export const dynamic = "force-dynamic"

export async function GET() {
  const workflows = await listWorkflowEntries()
  return Response.json({
    files: workflows.map((item) => item.name),
    workflows,
  })
}

export async function POST(request: Request) {
  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof File)) {
    return Response.json({ error: "请选择 JSON 文件" }, { status: 400 })
  }
  try {
    const text = await file.text()
    const data = JSON.parse(text) as unknown
    const saved = await parseAndSaveWorkflow(file.name, data)
    const bundle = await readWorkflowBundle(saved)
    return Response.json(bundle)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "导入失败" },
      { status: 400 }
    )
  }
}

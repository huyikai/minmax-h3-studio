import fs from "node:fs/promises"
import path from "node:path"
import { getJob, toPublicJob, upsertJob } from "@/lib/jobs"
import { longWorkflowCapabilities } from "@/lib/default-workflows"
import { jobOutputDir } from "@/lib/paths"
import {
  canChangeLongWorkflow,
  longWorkflowIncompatibility,
  longWorkflowInputFlags,
} from "@/lib/long-video"
import { publicLockRefs } from "@/lib/long-media"

export async function PUT(
  request: Request,
  context: RouteContext<"/api/jobs/[id]/workflow">
) {
  const { id } = await context.params
  const job = await getJob(id)
  if (!job || job.kind !== "long" || !job.long) {
    return Response.json({ error: "不是可配置的长视频任务" }, { status: 400 })
  }
  if (!canChangeLongWorkflow(job)) {
    return Response.json({ error: "已有片段后不能切换工作流" }, { status: 409 })
  }
  const body = (await request.json()) as { workflowFile?: unknown }
  const workflowFile = String(body.workflowFile ?? "")
  const capabilities = longWorkflowCapabilities(workflowFile)
  if (!capabilities?.motionContext) {
    return Response.json({ error: "请选择包含 Motion Context 的长视频工作流" }, { status: 400 })
  }
  const incompatible = longWorkflowIncompatibility(
    workflowFile,
    longWorkflowInputFlags({ publicRefs: publicLockRefs(job) })
  )
  if (incompatible) {
    return Response.json({ error: incompatible }, { status: 400 })
  }
  const saved = await upsertJob({
    ...job,
    workflowFile,
    long: { ...job.long, workflowFile, workflowKind: capabilities.kind },
  })
  return Response.json({ job: toPublicJob(saved) })
}


export async function GET(
  _request: Request,
  context: RouteContext<"/api/jobs/[id]/workflow">
) {
  const { id } = await context.params
  const job = await getJob(id)
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 })
  const file = path.join(jobOutputDir(job.id), "workflow.json")
  try {
    const text = await fs.readFile(file, "utf8")
    return new Response(text, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${job.id}-workflow.json"`,
      },
    })
  } catch {
    return Response.json({ error: "还没有本次提交的 JSON" }, { status: 404 })
  }
}

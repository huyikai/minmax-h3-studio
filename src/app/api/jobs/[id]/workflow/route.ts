import fs from "node:fs/promises"
import path from "node:path"
import { getJob } from "@/lib/jobs"
import { jobOutputDir } from "@/lib/paths"

export const dynamic = "force-dynamic"

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

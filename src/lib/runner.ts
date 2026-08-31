import { getJob, upsertJob } from "@/lib/jobs"
import {
  findVideoOutput,
  getHistory,
  saveJobOutput,
  subscribeComfyProgress,
} from "@/lib/comfy"
import type { Job } from "@/lib/types"
import fs from "node:fs/promises"
import path from "node:path"
import { jobOutputDir } from "@/lib/paths"

const watching = new Map<string, Promise<void>>()

export function ensureJobWatch(jobId: string) {
  if (watching.has(jobId)) return
  const run = watchJob(jobId).finally(() => watching.delete(jobId))
  watching.set(jobId, run)
}

async function watchJob(jobId: string) {
  const initial = await getJob(jobId)
  if (!initial?.comfyPromptId) return
  if (initial.status === "success" || initial.status === "error" || initial.status === "interrupted") {
    return
  }

  const promptId = initial.comfyPromptId
  const stop = subscribeComfyProgress(initial.clientId, promptId, async (event) => {
    const job = await getJob(jobId)
    if (!job) return
    if (event.type === "progress") {
      await upsertJob({
        ...job,
        status: "running",
        progress: {
          value: event.value,
          max: event.max,
          node: event.node,
          nodeTitle: nodeTitle(job, event.node),
        },
      })
    } else if (event.type === "executing") {
      await upsertJob({
        ...job,
        status: "running",
        progress: {
          value: job.progress?.value ?? 0,
          max: job.progress?.max ?? 0,
          node: event.node,
          nodeTitle: nodeTitle(job, event.node),
        },
      })
    } else if (event.type === "error") {
      await upsertJob({ ...job, status: "error", error: event.message })
    }
  })

  const started = Date.now()
  const limit = 3 * 60 * 60 * 1000
  try {
    while (Date.now() - started < limit) {
      const job = await getJob(jobId)
      if (!job) return
      if (job.status === "error" || job.status === "interrupted") return
      if (job.status === "success" && job.outputFile) return

      const history = await getHistory(promptId)
      if (history?.status?.status_str === "error") {
        await upsertJob({
          ...job,
          status: "error",
          error: "ComfyUI 标记该任务失败，请打开 ComfyUI 查看完整日志。",
        })
        return
      }

      const video = findVideoOutput(history?.outputs)
      if (video) {
        const outputPath = await saveJobOutput(job, video)
        await upsertJob({
          ...job,
          status: "success",
          outputFile: outputPath,
          progress: {
            value: job.progress?.max ?? 1,
            max: job.progress?.max ?? 1,
            nodeTitle: "完成",
          },
        })
        return
      }

      if (history?.status?.completed && !video) {
        await upsertJob({
          ...job,
          status: "error",
          error:
            "任务已完成，但没有找到视频文件。请确认工作流包含 SaveVideo / 输出视频节点。",
        })
        return
      }

      await sleep(1000)
    }
    const job = await getJob(jobId)
    if (job && job.status !== "success") {
      await upsertJob({ ...job, status: "error", error: "等待成片超时。" })
    }
  } catch (error) {
    const job = await getJob(jobId)
    if (job && job.status !== "success") {
      await upsertJob({
        ...job,
        status: "error",
        error: error instanceof Error ? error.message : "监视任务失败",
      })
    }
  } finally {
    stop()
  }
}

function nodeTitle(job: Job, nodeId?: string) {
  if (!nodeId) return job.progress?.nodeTitle
  return job.progress?.node === nodeId ? job.progress.nodeTitle : `节点 ${nodeId}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function writeSubmittedWorkflow(
  jobId: string,
  workflow: unknown
) {
  const dir = jobOutputDir(jobId)
  await fs.mkdir(dir, { recursive: true })
  const fullPath = path.join(dir, "workflow.json")
  await fs.writeFile(fullPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8")
  return fullPath
}

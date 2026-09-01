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
import { isBusyJob } from "@/lib/job-view"
import {
  chainDeliveredSeconds,
  isLongJob,
  rewriteLatentError,
  segmentFileName,
  successfulSegments,
} from "@/lib/long-video"
import { stitchSegmentFiles } from "@/lib/stitch"

const watching = new Map<string, Promise<void>>()

export function ensureJobWatch(jobId: string) {
  if (watching.has(jobId)) return
  const run = watchJob(jobId).finally(() => watching.delete(jobId))
  watching.set(jobId, run)
}

async function watchJob(jobId: string) {
  const initial = await getJob(jobId)
  if (!initial?.comfyPromptId) return
  if (!isBusyJob(initial)) return

  const promptId = initial.comfyPromptId
  const stop = subscribeComfyProgress(initial.clientId, promptId, async (event) => {
    const job = await getJob(jobId)
    if (!job || job.comfyPromptId !== promptId || !isBusyJob(job)) return
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
      await failJob(job, event.message)
    }
  })

  const started = Date.now()
  const limit = 3 * 60 * 60 * 1000
  try {
    while (Date.now() - started < limit) {
      const job = await getJob(jobId)
      if (!job) return
      if (job.comfyPromptId !== promptId) return
      if (!isBusyJob(job)) return

      const history = await getHistory(promptId)
      if (history?.status?.status_str === "error") {
        await failJob(job, "ComfyUI 标记该任务失败，请打开 ComfyUI 查看完整日志。")
        return
      }

      const video = findVideoOutput(history?.outputs)
      if (video) {
        if (isLongJob(job)) {
          await completeLongSegment(job, video)
        } else {
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
        }
        await import("@/lib/studio-queue").then((mod) => mod.pumpQueue())
        return
      }

      if (history?.status?.completed && !video) {
        await failJob(
          job,
          "任务已完成，但没有找到视频文件。请确认工作流包含 SaveVideo / 输出视频节点。"
        )
        return
      }

      await sleep(1000)
    }
    const job = await getJob(jobId)
    if (job && isBusyJob(job) && job.comfyPromptId === promptId) {
      await failJob(job, "等待成片超时。")
    }
  } catch (error) {
    const job = await getJob(jobId)
    if (job && isBusyJob(job) && job.comfyPromptId === promptId) {
      await failJob(
        job,
        error instanceof Error ? error.message : "监视任务失败"
      )
    }
  } finally {
    stop()
  }
}

async function completeLongSegment(
  job: Job,
  video: { filename: string; subfolder?: string; type?: string }
) {
  const long = job.long
  if (!long) return
  const index =
    long.segments.find((item) => item.comfyPromptId === job.comfyPromptId)
      ?.index ?? long.segments.find((item) => item.status === "running")?.index
  if (!index) {
    await failJob(job, "找不到当前正在生成的片段。")
    return
  }

  const outputPath = await saveJobOutput(job, video, segmentFileName(index))
  const segments = long.segments.map((item) =>
    item.index === index
      ? {
          ...item,
          status: "success" as const,
          outputFile: outputPath,
          error: undefined,
        }
      : item
  )
  const nextLong = {
    ...long,
    aspectLocked: true,
    segments,
    stitchError: undefined as string | undefined,
  }
  const successFiles = successfulSegments(nextLong)
    .map((item) => item.outputFile)
    .filter((file): file is string => Boolean(file))

  try {
    nextLong.stitchedFile = await stitchSegmentFiles(job.id, successFiles)
  } catch (error) {
    nextLong.stitchError =
      error instanceof Error ? error.message : "拼接失败"
  }

  await upsertJob({
    ...job,
    status: "awaiting",
    error: undefined,
    outputFile: outputPath,
    duration: chainDeliveredSeconds(nextLong),
    seed:
      segments.find((item) => item.index === index)?.seed ?? job.seed,
    long: nextLong,
    progress: {
      value: job.progress?.max ?? 1,
      max: job.progress?.max ?? 1,
      nodeTitle: `第 ${index} 段完成`,
    },
  })
}

async function failJob(job: Job, message: string) {
  const error = rewriteLatentError(message)
  if (!isLongJob(job) || !job.long) {
    await upsertJob({ ...job, status: "error", error })
  } else {
    const promptId = job.comfyPromptId
    await upsertJob({
      ...job,
      status: "error",
      error,
      long: {
        ...job.long,
        segments: job.long.segments.map((item) =>
          item.comfyPromptId === promptId || item.status === "running"
            ? { ...item, status: "error" as const, error }
            : item
        ),
      },
    })
  }
  await import("@/lib/studio-queue").then((mod) => mod.pumpQueue())
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
  await fs.writeFile(fullPath, `${JSON.stringify(workflow, null, 2)}\n`, { encoding: "utf8" })
  return fullPath
}

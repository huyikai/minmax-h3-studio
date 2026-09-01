import { ASPECT_PRESETS, DURATION_OPTIONS } from "@/lib/types"
import type { Job, LongSegment } from "@/lib/types"
import { getJob, toPublicJob, upsertJob } from "@/lib/jobs"
import { evaluateEnvironment } from "@/lib/environment"
import { afterEnqueue, queueSnapshot } from "@/lib/studio-queue"
import { newClientId } from "@/lib/comfy"
import {
  isLongJob,
  mergeLockIntoPrompt,
  nextClipIndex,
  retryableSegment,
  voidSegmentsAfter,
  waitingSegment,
} from "@/lib/long-video"

export const dynamic = "force-dynamic"

type Body = {
  prompt?: string
  duration?: number
  aspect?: string
  seed?: number
  lockPrompt?: string
  redoIndex?: number
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/jobs/[id]/segments">
) {
  const { id } = await context.params
  const job = await getJob(id)
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 })
  if (!isLongJob(job) || !job.long) {
    return Response.json({ error: "这不是长视频任务" }, { status: 400 })
  }
  if (job.long.finalized) {
    return Response.json(
      { error: "已经定稿。请先撤销定稿再继续。" },
      { status: 409 }
    )
  }
  if (waitingSegment(job.long)) {
    return Response.json(
      { error: "下一段已在队列里。要改词请先从队列撤下。" },
      { status: 409 }
    )
  }

  const body = (await request.json()) as Body
  const prompt = String(body.prompt ?? "").trim()
  if (!prompt) {
    return Response.json({ error: "请填写这一段的提示词" }, { status: 400 })
  }

  const duration = Number(body.duration ?? 5)
  if (!(DURATION_OPTIONS as readonly number[]).includes(duration)) {
    return Response.json({ error: "时长不在可选范围内" }, { status: 400 })
  }

  const seed = Number.isFinite(Number(body.seed))
    ? Number(body.seed)
    : Math.floor(Math.random() * 1_000_000_000)

  const lockPrompt =
    body.lockPrompt !== undefined ? String(body.lockPrompt) : job.long.lockPrompt

  const redoIndex =
    typeof body.redoIndex === "number" && Number.isInteger(body.redoIndex)
      ? body.redoIndex
      : undefined

  let clipIndex: number
  let segments = job.long.segments
  if (redoIndex !== undefined) {
    const target = segments.find((item) => item.index === redoIndex)
    if (!target || target.status === "voided") {
      return Response.json({ error: "没有这一段可以重做" }, { status: 400 })
    }
    clipIndex = redoIndex
    segments = voidSegmentsAfter(segments, redoIndex).filter(
      (item) => item.index !== redoIndex
    )
  } else {
    const retry = retryableSegment(job.long)
    clipIndex = retry ? retry.index : nextClipIndex(job.long)
    if (retry) {
      segments = segments.filter((item) => item.index !== retry.index)
    } else {
      const expected = nextClipIndex(job.long)
      if (clipIndex !== expected) {
        return Response.json(
          { error: `下一段必须是第 ${expected} 段，不能跳段` },
          { status: 400 }
        )
      }
    }
  }

  if (clipIndex < 1) {
    return Response.json({ error: "片段编号无效" }, { status: 400 })
  }
  if (clipIndex > 1) {
    const previous = job.long.segments.find((item) => item.index === clipIndex - 1)
    if (
      !previous ||
      previous.status === "voided" ||
      previous.status === "error" ||
      previous.status === "interrupted"
    ) {
      return Response.json(
        { error: `第 ${clipIndex - 1} 段还没有成功，不能跳段` },
        { status: 400 }
      )
    }
  }

  let aspect = job.aspect
  let width = job.width
  let height = job.height
  if (body.aspect && body.aspect !== job.aspect) {
    if (job.long.aspectLocked) {
      return Response.json(
        { error: "第一段成功后画幅已锁定，整条链必须同一分辨率" },
        { status: 400 }
      )
    }
    const preset =
      ASPECT_PRESETS.find((item) => item.id === body.aspect) ?? ASPECT_PRESETS[0]
    aspect = preset.id
    width = preset.width
    height = preset.height
  }

  const env = await evaluateEnvironment("long")
  if (!env.ready) {
    return Response.json(
      { error: env.summary, code: "environment_incomplete", gaps: env.gaps },
      { status: 412 }
    )
  }

  const submittedPrompt = mergeLockIntoPrompt(lockPrompt, prompt)
  const now = new Date().toISOString()
  const segment: LongSegment = {
    index: clipIndex,
    prompt,
    submittedPrompt,
    duration,
    seed,
    status: "waiting",
    enqueuedAt: now,
  }
  const kept = segments.filter((item) => item.index !== clipIndex)
  const nextSegments = [...kept, segment].sort((a, b) => a.index - b.index)
  const busy = job.status === "queued" || job.status === "running"

  const waiting: Job = await upsertJob({
    ...job,
    status: busy ? job.status : "waiting",
    prompt: busy ? job.prompt : prompt,
    duration: busy ? job.duration : duration,
    aspect,
    width,
    height,
    seed: busy ? job.seed : seed,
    clientId: busy ? job.clientId : newClientId(),
    enqueuedAt: busy ? job.enqueuedAt : now,
    error: busy ? job.error : undefined,
    long: {
      ...job.long,
      lockPrompt,
      finalized: false,
      segments: nextSegments,
    },
  })

  await afterEnqueue()
  const current = (await getJob(id)) ?? waiting
  return Response.json({
    job: toPublicJob(current),
    queue: await queueSnapshot(),
  })
}

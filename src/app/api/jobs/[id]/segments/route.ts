import { ASPECT_PRESETS, DURATION_OPTIONS, LONG_STEP_OPTIONS } from "@/lib/types"
import type { Job, LongSegment } from "@/lib/types"
import { resolutionFor, resolutionPreset } from "@/lib/resolution"
import { getJob, toPublicJob, upsertJob } from "@/lib/jobs"
import { evaluateEnvironment } from "@/lib/environment"
import { afterEnqueue, queueSnapshot } from "@/lib/studio-queue"
import { newClientId } from "@/lib/comfy"
import { stopActiveRun } from "@/lib/job-interrupt"
import {
  chainBreakSegment,
  isLongJob,
  laterSegments,
  liveSegments,
  mergeLockIntoPrompt,
  nextClipIndex,
  voidSegmentsAfter,
} from "@/lib/long-video"

export const dynamic = "force-dynamic"

type Body = {
  prompt?: string
  duration?: number
  aspect?: string
  megapixels?: number
  steps?: number
  seed?: number
  lockPrompt?: string
  redoIndex?: number
}

function parseSteps(value: unknown, fallback: number) {
  const numeric = Number(value)
  if ((LONG_STEP_OPTIONS as readonly number[]).includes(numeric)) return numeric
  return fallback
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/jobs/[id]/segments">
) {
  const { id } = await context.params
  let job = await getJob(id)
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

  const broken = chainBreakSegment(job.long)
  let clipIndex: number
  if (redoIndex !== undefined) {
    const target = job.long.segments.find((item) => item.index === redoIndex)
    if (!target || target.status === "voided") {
      return Response.json({ error: "没有这一段可以重做" }, { status: 400 })
    }
    clipIndex = redoIndex
  } else if (broken) {
    clipIndex = broken.index
  } else {
    clipIndex = nextClipIndex(job.long)
  }

  if (clipIndex < 1) {
    return Response.json({ error: "片段编号无效" }, { status: 400 })
  }

  if (broken && clipIndex > broken.index) {
    return Response.json(
      { error: `第 ${broken.index} 段失败或中断，请先重写这一段。后面的段暂时接不上。` },
      { status: 409 }
    )
  }

  if (redoIndex === undefined && !broken) {
    const expected = nextClipIndex(job.long)
    if (clipIndex !== expected) {
      return Response.json(
        { error: `下一段必须是第 ${expected} 段，不能跳段` },
        { status: 400 }
      )
    }
  }

  const existing = liveSegments(job.long).find((item) => item.index === clipIndex)
  const later = laterSegments(job.long, clipIndex)
  const replacing = Boolean(existing) || later.length > 0

  if (existing && (existing.status === "queued" || existing.status === "running")) {
    job = await stopActiveRun(job)
    if (!job.long) {
      return Response.json({ error: "这不是长视频任务" }, { status: 400 })
    }
  }

  let segments = job.long.segments
  if (replacing) {
    segments = voidSegmentsAfter(segments, clipIndex).filter(
      (item) => item.index !== clipIndex
    )
  }

  if (clipIndex > 1) {
    const previous = segments.find((item) => item.index === clipIndex - 1)
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
  let megapixels = job.megapixels ?? 0.98
  let width = job.width
  let height = job.height
  const requestedAspect = body.aspect && body.aspect !== job.aspect
  const requestedMegapixels =
    body.megapixels !== undefined && body.megapixels !== megapixels
  if (clipIndex === 1) {
    const preset =
      ASPECT_PRESETS.find((item) => item.id === (body.aspect ?? job.aspect)) ??
      ASPECT_PRESETS[0]
    aspect = preset.id
    megapixels = resolutionPreset(body.megapixels) ?? megapixels
    const resolution = resolutionFor(aspect, megapixels)
    width = resolution.width
    height = resolution.height
  } else if (requestedAspect || requestedMegapixels) {
    if (job.long.aspectLocked) {
      return Response.json(
        { error: "第一段提交后画幅和清晰度已锁定，整条链必须同一分辨率" },
        { status: 400 }
      )
    }
  }

  const steps =
    clipIndex === 1 ? parseSteps(body.steps, job.steps ?? 20) : (job.steps ?? 20)

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
  const nextSegments = [...segments.filter((item) => item.index !== clipIndex), segment].sort(
    (a, b) => a.index - b.index
  )
  const busy = job.status === "queued" || job.status === "running"

  const waiting: Job = await upsertJob({
    ...job,
    status: busy ? job.status : "waiting",
    prompt: busy ? job.prompt : prompt,
    duration: busy ? job.duration : duration,
    aspect,
    megapixels,
    width,
    height,
    steps,
    seed: busy ? job.seed : seed,
    clientId: busy ? job.clientId : newClientId(),
    enqueuedAt: busy ? job.enqueuedAt : now,
    error: busy ? job.error : undefined,
    comfyPromptId: busy ? job.comfyPromptId : undefined,
    progress: busy ? job.progress : undefined,
    long: {
      ...job.long,
      lockPrompt,
      finalized: false,
      aspectLocked: true,
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

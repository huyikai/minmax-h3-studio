export type GuideMode = "t2v" | "i2v" | "flf" | "r2v"

export type GuideSectionId =
  | "alignment"
  | "subject_definitions"
  | "summary"
  | "retention_analysis"
  | "detailed_description"
  | "integrated_multimodal_description"
  | "overall_soundscape"
  | "non_diegetic_music"

export type GuideSection = {
  id: GuideSectionId
  label: string
  fieldName: string | null
  marker: GuideSectionId
}

const FIELD_MARKERS: Array<Exclude<GuideSectionId, "alignment">> = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "integrated_multimodal_description",
  "overall_soundscape",
  "non_diegetic_music",
]

const FIELD_PREFIX: Record<Exclude<GuideSectionId, "alignment">, string> = {
  subject_definitions: "subject_definitions:",
  summary: "summary:",
  retention_analysis: "retention_analysis:",
  detailed_description: "detailed_description:",
  integrated_multimodal_description: "integrated_multimodal_description:",
  overall_soundscape: "overall_soundscape:",
  non_diegetic_music: "non_diegetic_music:",
}

export function resolveGuideMode(input: {
  dynamicRefs: boolean
  hasLastFrame: boolean
  hasFirstFrame: boolean
}): GuideMode {
  if (input.dynamicRefs) return "r2v"
  if (input.hasLastFrame) return "flf"
  if (input.hasFirstFrame) return "i2v"
  return "t2v"
}

export function guideModeLabel(mode: GuideMode) {
  switch (mode) {
    case "t2v":
      return "文生"
    case "i2v":
      return "图生"
    case "flf":
      return "首尾帧"
    case "r2v":
      return "参考生"
  }
}

export function guidePanelTitle(mode: GuideMode) {
  if (mode === "r2v") return "参考生"
  return `基础 · ${guideModeLabel(mode)}`
}

const BASE_GUIDE_URL =
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md"
const REF_GUIDE_URL =
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md"

export function guideOfficialUrl(mode: GuideMode) {
  return mode === "r2v" ? REF_GUIDE_URL : BASE_GUIDE_URL
}

const COPY_FOOTER =
  "说明：点英文骨架写入输入框。已经有的字段会选中，不会再插一份。灰色中文不会写进去。"

export function formatGuidePack(mode: GuideMode, duration: number) {
  const lines = [
    `# 写法 · ${guidePanelTitle(mode)}`,
    `官方指南：${guideOfficialUrl(mode)}`,
    `当前时长：${formatSeconds(duration)} 秒`,
    "",
    "## 规则",
    ...guideRules(mode).map((rule) => `- ${rule}`),
  ]

  for (const section of guideSections(mode)) {
    const heading = section.fieldName
      ? `${section.label} · ${section.fieldName}`
      : section.label
    lines.push(
      "",
      `## ${heading}`,
      `用途：${sectionPurpose(mode, section.id)}`,
      "",
      "英文骨架：",
      "```",
      sectionBody(mode, section.id, duration),
      "```",
      "",
      "对照（不要写入提示词）：",
      sectionGloss(mode, section.id, duration)
    )
  }

  lines.push("", COPY_FOOTER)
  return lines.join("\n")
}

export function guideRules(mode: GuideMode): string[] {
  const shared = [
    "正文建议英文。对白、歌词、画面上的字保留原文。",
    "说话人用 (S1)。对白写成 <d>[Chinese] 回来了。</d>，语言标签按实际语言改。",
    "环境音和配乐分开写。没有配乐就写 N/A。灰色中文只对照，不会写入输入框。",
  ]
  if (mode === "i2v") {
    return [
      "基础模式。第一行必须是对齐指令：0.00 秒完整引用 <Picture 1>。",
      "从首帧往下写运动，不要复述已经能看见的静帧。镜头、运镜、对白都写在画面段里。",
      ...shared,
    ]
  }
  if (mode === "flf") {
    return [
      "基础模式。第一行对齐：Picture 1 是 0.00 秒，Picture 2 是当前选的时长。",
      "写两帧之间怎么过渡，优先单镜头。镜头、运镜、对白都写在画面段里。",
      ...shared,
    ]
  }
  if (mode === "r2v") {
    return [
      "参考生六段按顺序：定义 → 摘要 → 保留分析 → 画面 → 环境音 → 配乐。",
      "用 <Subject> / <Picture> / <Video> / <Audio> 标签，先定义再写画面。不要把两张参考混成一个人。",
      ...shared,
    ]
  }
  return [
    "基础模式。可点字段只有画面、环境音、配乐。镜头、运镜、对白写在画面段里，不要拆成独立字段。",
    "[Shot 1] 不要加时间戳。之后的镜头写 At 00:03.000。",
    ...shared,
  ]
}

export function guideSections(mode: GuideMode): GuideSection[] {
  if (mode === "r2v") {
    return [
      {
        id: "subject_definitions",
        label: "定义",
        fieldName: "subject_definitions",
        marker: "subject_definitions",
      },
      { id: "summary", label: "摘要", fieldName: "summary", marker: "summary" },
      {
        id: "retention_analysis",
        label: "保留分析",
        fieldName: "retention_analysis",
        marker: "retention_analysis",
      },
      {
        id: "detailed_description",
        label: "画面",
        fieldName: "detailed_description",
        marker: "detailed_description",
      },
      {
        id: "overall_soundscape",
        label: "环境音",
        fieldName: "overall_soundscape",
        marker: "overall_soundscape",
      },
      {
        id: "non_diegetic_music",
        label: "配乐",
        fieldName: "non_diegetic_music",
        marker: "non_diegetic_music",
      },
    ]
  }
  const core: GuideSection[] = [
    {
      id: "integrated_multimodal_description",
      label: "画面",
      fieldName: "integrated_multimodal_description",
      marker: "integrated_multimodal_description",
    },
    {
      id: "overall_soundscape",
      label: "环境音",
      fieldName: "overall_soundscape",
      marker: "overall_soundscape",
    },
    {
      id: "non_diegetic_music",
      label: "配乐",
      fieldName: "non_diegetic_music",
      marker: "non_diegetic_music",
    },
  ]
  if (mode === "i2v" || mode === "flf") {
    return [
      { id: "alignment", label: "对齐句", fieldName: null, marker: "alignment" },
      ...core,
    ]
  }
  return core
}

export function sectionPurpose(mode: GuideMode, id: GuideSectionId) {
  if (id === "alignment") {
    return mode === "flf"
      ? "点下去插到提示词第一行：首帧对齐 0.00 秒，尾帧对齐当前时长。"
      : "点下去插到提示词第一行：0.00 秒完整引用首帧 <Picture 1>。"
  }
  if (id === "integrated_multimodal_description") {
    if (mode === "i2v") {
      return "写入画面主字段。从首帧接着写运动、镜头和对白，不要复述静帧里已经能看见的细节。"
    }
    if (mode === "flf") {
      return "写入画面主字段。写从首帧走到尾帧的路径，镜头、运镜、对白都放这里。"
    }
    return "写入画面主字段。风格、构图、动作、分镜、对白都写在这一段。"
  }
  if (id === "detailed_description") {
    return "写入参考生的画面主字段。按成片播放顺序写镜头，并在第一次出现处点名参考标签。"
  }
  if (id === "overall_soundscape") {
    return "写入环境音：全片氛围、动作声、非语言人声。对白和配乐不要写在这里。"
  }
  if (id === "non_diegetic_music") {
    return "写入观众听到的配乐（角色听不见）。没有配乐就保留 N/A。"
  }
  if (id === "subject_definitions") {
    return "先定义每个参考标签是谁、从哪张图/哪段视频来、负责什么。"
  }
  if (id === "summary") {
    return "一段英文摘要，方括号里写任务类型，例如 [reference generation]。"
  }
  return "逐条写每个标签在成片里是完全保留、部分保留，还是只作弱参考。"
}

export function sectionGloss(mode: GuideMode, id: GuideSectionId, duration: number) {
  const seconds = formatSeconds(duration)
  if (id === "alignment") {
    if (mode === "flf") {
      return `参考图与成片对齐：Picture 1（Shot 1）对齐 0.00 秒；Picture 2（Shot 1）对齐 ${seconds} 秒。`
    }
    return "目标视频从 0.00 秒起完整引用 <Picture 1>（来自 [Shot 1]）。"
  }
  if (id === "integrated_multimodal_description") {
    if (mode === "i2v") {
      return "实拍电影感。[Shot 1] <Picture 1> 里的女人保持同一身份、服装和场景。镜头小幅慢速右移，她起身看向窗外的雨。气声年轻女人 (S1) 说：<d>[Chinese] 回来了。</d>"
    }
    if (mode === "flf") {
      return "实拍电影感。[Shot 1] 从 Picture 1 的站位和构图开始。镜头小幅慢速后拉，她走到椅子边，在镜头结束时落成 Picture 2 的姿势、间距和构图。"
    }
    return "实拍电影感。[Shot 1] 中全景：黄昏海边栈道，红风衣女人面向镜头。镜头小幅慢速前推，风掀起头发。气声年轻女人 (S1) 说：<d>[Chinese] 回来了。</d>"
  }
  if (id === "overall_soundscape") {
    if (mode === "r2v") return "室内底噪贯穿全片。"
    if (mode === "i2v" || mode === "flf") return "雨点敲窗，远处车流。衣服随着动作轻响。"
    return "浪拍栈道，远处海鸥。风扯着外套。"
  }
  if (id === "non_diegetic_music") return "无观众配乐。"
  if (id === "subject_definitions") {
    return "<Subject 1> 是 <Picture 1> 里的人，外貌以这张图为准。<Video 1> 负责动作、节奏和机位。"
  }
  if (id === "summary") {
    return "[参考生成] 成片用 <Subject 1> 锁定身份，用 <Video 1> 锁定动作。"
  }
  if (id === "retention_analysis") {
    return "<Subject 1>（出现在 [Shot 1]）：完全保留外貌、服装。<Video 1>（动作和节奏）：弱参考，只借节奏和镜头语言，不照搬剪辑。"
  }
  return "成片为实拍电影感。[Shot 1] 中景出现 <Subject 1>。动作和机位跟 <Video 1>。<Subject 1> (S1) 说：<d>[Chinese] 回来了。</d>"
}

export function sectionBody(
  mode: GuideMode,
  id: GuideSectionId,
  duration: number
) {
  const seconds = formatSeconds(duration)
  if (id === "alignment") {
    if (mode === "flf") {
      return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${seconds}-second mark of the target video.`
    }
    return "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced."
  }
  if (id === "integrated_multimodal_description") {
    if (mode === "i2v") {
      return `integrated_multimodal_description: [Shot 1] Live-action, cinematic, the woman shown in <Picture 1> keeps the same identity, clothing, and scene. The camera trucks right with small amplitude at slow speed as she stands and turns toward the rain. The quiet, breathy young woman (S1) says: <d>[Chinese] 回来了。</d>`
    }
    if (mode === "flf") {
      return `integrated_multimodal_description: [Shot 1] Live-action, cinematic, she begins in the stance and framing of Picture 1. The camera pulls out with small amplitude at slow speed as she walks to the chair and settles into the pose, spacing, and composition of Picture 2 at the end of the shot.`
    }
    return `integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium-wide shot frames a woman in a red coat on a dusk seaside boardwalk, facing the camera. The camera pushes in with small amplitude at slow speed as wind lifts her hair. The young woman with a quiet, breathy voice (S1) says: <d>[Chinese] 回来了。</d>`
  }
  if (id === "overall_soundscape") {
    if (mode === "r2v") {
      return "overall_soundscape: Quiet indoor room tone continues throughout the scene."
    }
    if (mode === "i2v" || mode === "flf") {
      return "overall_soundscape: Rain ticks against the window while distant traffic passes. Fabric shifts as she moves."
    }
    return "overall_soundscape: Waves break against the pier while distant gulls call. Wind pulls at her coat."
  }
  if (id === "non_diegetic_music") {
    return "non_diegetic_music: N/A"
  }
  if (id === "subject_definitions") {
    return `subject_definitions:
<Subject 1> is the person whose appearance comes from <Picture 1>.
<Video 1> is the motion, pacing, and camera reference.`
  }
  if (id === "summary") {
    return "summary:\n[reference generation] The target video uses <Subject 1> for identity and <Video 1> for motion."
  }
  if (id === "retention_analysis") {
    return `retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - identity, clothing, and appearance are retained.
<Video 1> (motion and pacing): weak_reference - rhythm and camera language are referenced without copying the source edit.`
  }
  return `detailed_description:
The target video is live-action and cinematic.
[Shot 1] A medium shot opens on <Subject 1>. Motion and camera follow <Video 1>. <Subject 1> (S1) says: <d>[Chinese] 回来了。</d>`
}

export function applySectionInsert(
  text: string,
  mode: GuideMode,
  sectionId: GuideSectionId,
  duration: number
) {
  const sections = guideSections(mode)
  const index = sections.findIndex((item) => item.id === sectionId)
  const body = sectionBody(mode, sectionId, duration).trim()
  if (index < 0) {
    return { text, selection: { start: 0, end: 0 } }
  }

  const existing = findBlock(text, sectionId)
  if (existing) {
    return { text, selection: existing }
  }

  const order = sections.map((item) => item.marker)
  for (let i = index + 1; i < order.length; i++) {
    const found = findBlock(text, order[i])
    if (found) {
      return splice(text, found.start, body, "before")
    }
  }
  for (let i = index - 1; i >= 0; i--) {
    const found = findBlock(text, order[i])
    if (found) {
      return splice(text, found.end, body, "after")
    }
  }

  const trimmed = text.trim()
  if (!trimmed) {
    return { text: body, selection: { start: 0, end: body.length } }
  }
  if (index === 0) {
    const next = `${body}\n\n${trimmed}`
    return { text: next, selection: { start: 0, end: body.length } }
  }
  const next = `${trimmed}\n\n${body}`
  const start = trimmed.length + 2
  return { text: next, selection: { start, end: start + body.length } }
}

function formatSeconds(duration: number) {
  const value = Number.isFinite(duration) && duration > 0 ? duration : 5
  return value.toFixed(2)
}

function findBlock(text: string, marker: GuideSectionId) {
  if (marker === "alignment") {
    const match = /(?:^|\n)(For the target video,|How the reference pictures align with the target video)/.exec(
      text
    )
    if (!match) return null
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0)
    return { start, end: blockEnd(text, start) }
  }
  const prefix = FIELD_PREFIX[marker]
  const match = new RegExp(`(?:^|\\n)(${escapeRegExp(prefix)})`).exec(text)
  if (!match) return null
  const start = match.index + (match[0].startsWith("\n") ? 1 : 0)
  return { start, end: blockEnd(text, start) }
}

function blockEnd(text: string, start: number) {
  const firstNl = text.indexOf("\n", start)
  if (firstNl < 0) return text.length
  const tail = text.slice(firstNl + 1)
  const next = nextMarkerOffset(tail)
  if (next < 0) return text.length
  return firstNl + 1 + next
}

function nextMarkerOffset(text: string) {
  const field = FIELD_MARKERS.map((id) => escapeRegExp(FIELD_PREFIX[id])).join("|")
  const match = new RegExp(
    `^(?:For the target video,|How the reference pictures align with the target video|${field})`,
    "m"
  ).exec(text)
  return match ? match.index : -1
}

function splice(
  text: string,
  at: number,
  body: string,
  where: "before" | "after"
) {
  if (where === "before") {
    const before = text.slice(0, at).trimEnd()
    const after = text.slice(at).trimStart()
    const next = [before, body, after].filter((part) => part.length > 0).join("\n\n")
    const start = before.length === 0 ? 0 : before.length + 2
    return { text: next, selection: { start, end: start + body.length } }
  }
  const before = text.slice(0, at).trimEnd()
  const after = text.slice(at).trimStart()
  const next = [before, body, after].filter((part) => part.length > 0).join("\n\n")
  const start = before.length === 0 ? 0 : before.length + 2
  return { text: next, selection: { start, end: start + body.length } }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

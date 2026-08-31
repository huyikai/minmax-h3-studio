import type {
  ApiWorkflow,
  ComfyNode,
  FieldMapping,
  LoraFormValue,
  LoraMapping,
  MappingOverrides,
  WorkflowMapping,
} from "@/lib/types"
import { ASPECT_PRESETS } from "@/lib/types"

const H3_VIDEO_CLASSES = new Set([
  "MiniMaxH3ImageToVideo",
  "MiniMaxH3ReferenceToVideo",
])

const LORA_CLASSES = new Set([
  "LoraLoader",
  "LoraLoaderModelOnly",
  "Power Lora Loader (rgthree)",
])

const LOAD_IMAGE_CLASSES = new Set(["LoadImage", "LoadImageOutput"])

const PROMPT_TEXT_CLASSES = new Set([
  "CLIPTextEncode",
  "CLIPTextEncodeSDXL",
  "CLIPTextEncodeHunyuanDiT",
])

const SEED_CLASSES: Array<{ classType: string; input: string }> = [
  { classType: "RandomNoise", input: "noise_seed" },
  { classType: "Noise_RandomNoise", input: "noise_seed" },
  { classType: "KSampler", input: "seed" },
  { classType: "KSamplerAdvanced", input: "noise_seed" },
]

export function isUiWorkflow(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Array.isArray((data as { nodes?: unknown }).nodes)
  )
}

export function unwrapPromptEnvelope(data: unknown): unknown {
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    "prompt" in data &&
    (data as { prompt: unknown }).prompt &&
    typeof (data as { prompt: unknown }).prompt === "object"
  ) {
    return (data as { prompt: unknown }).prompt
  }
  return data
}

export function isApiWorkflow(data: unknown): data is ApiWorkflow {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false
  if (isUiWorkflow(data)) return false
  const values = Object.values(data as Record<string, unknown>)
  if (values.length === 0) return false
  return values.every(
    (value) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as ComfyNode).class_type === "string" &&
      (value as ComfyNode).inputs &&
      typeof (value as ComfyNode).inputs === "object"
  )
}

export function parseApiWorkflow(data: unknown): ApiWorkflow {
  const unwrapped = unwrapPromptEnvelope(data)
  if (isUiWorkflow(unwrapped)) {
    throw new Error(
      "这是 ComfyUI 画布格式，不能直接提交。请在 ComfyUI 中使用「文件 → 导出（API）」后再导入。"
    )
  }
  if (!isApiWorkflow(unwrapped)) {
    throw new Error("无法识别为 ComfyUI API 工作流 JSON。")
  }
  return structuredClone(unwrapped)
}

export function secondsToH3Length(seconds: number): number {
  const frames = Math.max(5, Math.round(seconds * 24))
  const rem = ((frames % 17) + 17) % 17
  const delta = (5 - rem + 17) % 17
  return frames + delta
}

export function lengthToSeconds(length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 5
  return Math.max(1, Math.round(length / 24))
}

function nodeTitle(node: ComfyNode) {
  return node._meta?.title ?? ""
}

function findNode(
  workflow: ApiWorkflow,
  predicate: (id: string, node: ComfyNode) => boolean
): [string, ComfyNode] | undefined {
  return Object.entries(workflow).find(([id, node]) => predicate(id, node))
}

function linkTarget(value: unknown): string | undefined {
  if (Array.isArray(value) && typeof value[0] === "string") return value[0]
  if (Array.isArray(value) && typeof value[0] === "number") return String(value[0])
  return undefined
}

export function detectMapping(workflow: ApiWorkflow): WorkflowMapping {
  const mapping: WorkflowMapping = { loras: [] }
  const h3 = findNode(workflow, (_, node) =>
    H3_VIDEO_CLASSES.has(node.class_type)
  )

  if (h3) {
    const [id, node] = h3
    mapping.prompt = { nodeId: id, input: "prompt" }
    mapping.width = { nodeId: id, input: "width" }
    mapping.height = { nodeId: id, input: "height" }

    const durationPrimitive = findNode(workflow, (_, candidate) => {
      const title = nodeTitle(candidate)
      return (
        /duration|时长|秒/i.test(title) &&
        (candidate.class_type === "PrimitiveFloat" ||
          candidate.class_type === "PrimitiveInt")
      )
    })
    if (durationPrimitive) {
      mapping.duration = { nodeId: durationPrimitive[0], input: "value" }
      mapping.durationUnit = "seconds"
    } else {
      mapping.duration = { nodeId: id, input: "length" }
      mapping.durationUnit = "frames"
    }

    const firstLink = linkTarget(node.inputs.first_frame)
    if (firstLink && workflow[firstLink] && LOAD_IMAGE_CLASSES.has(workflow[firstLink].class_type)) {
      mapping.firstFrame = { nodeId: firstLink, input: "image" }
    } else {
      const loadImage = findNode(workflow, (_, candidate) =>
        LOAD_IMAGE_CLASSES.has(candidate.class_type)
      )
      if (loadImage) {
        mapping.firstFrame = { nodeId: loadImage[0], input: "image" }
      }
    }
  }

  if (!mapping.prompt) {
    const clip = findNode(
      workflow,
      (_, node) =>
        PROMPT_TEXT_CLASSES.has(node.class_type) &&
        !/neg|负/i.test(nodeTitle(node))
    )
    if (clip) mapping.prompt = { nodeId: clip[0], input: "text" }
  }

  for (const { classType, input } of SEED_CLASSES) {
    const found = findNode(workflow, (_, node) => node.class_type === classType)
    if (found) {
      mapping.seed = { nodeId: found[0], input }
      break
    }
  }

  const scheduler = findNode(
    workflow,
    (_, node) => node.class_type === "BasicScheduler"
  )
  if (scheduler) {
    mapping.steps = { nodeId: scheduler[0], input: "steps" }
  } else {
    const sampler = findNode(
      workflow,
      (_, node) =>
        node.class_type === "KSampler" || node.class_type === "KSamplerAdvanced"
    )
    if (sampler) {
      mapping.steps = { nodeId: sampler[0], input: "steps" }
      if (sampler[1].inputs.cfg !== undefined) {
        mapping.cfg = { nodeId: sampler[0], input: "cfg" }
      }
    }
  }

  for (const [id, node] of Object.entries(workflow)) {
    if (node.class_type === "LoraLoader" || node.class_type === "LoraLoaderModelOnly") {
      mapping.loras.push({
        nodeId: id,
        nameInput: "lora_name",
        strengthInput: "strength_model",
      })
      continue
    }
    if (node.class_type === "Power Lora Loader (rgthree)") {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (
          /^lora_?\d+/i.test(key) &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          mapping.loras.push({
            nodeId: id,
            nameInput: key,
            strengthInput: key,
            nested: true,
          })
        }
      }
    }
  }

  return mapping
}

function applyFieldOverride<K extends keyof WorkflowMapping>(
  mapping: WorkflowMapping,
  overrides: MappingOverrides,
  key: K
) {
  if (!(key in overrides)) return
  const value = overrides[key as keyof MappingOverrides]
  if (value === null) {
    if (key === "loras") mapping.loras = []
    else delete mapping[key]
    return
  }
  if (value !== undefined) {
    ;(mapping[key] as WorkflowMapping[K]) = value as WorkflowMapping[K]
  }
}

export function mergeMapping(
  detected: WorkflowMapping,
  overrides?: MappingOverrides
): WorkflowMapping {
  const merged: WorkflowMapping = {
    ...detected,
    loras: detected.loras.map((item) => ({ ...item })),
  }
  if (!overrides) return merged
  applyFieldOverride(merged, overrides, "prompt")
  applyFieldOverride(merged, overrides, "firstFrame")
  applyFieldOverride(merged, overrides, "duration")
  applyFieldOverride(merged, overrides, "durationUnit")
  applyFieldOverride(merged, overrides, "width")
  applyFieldOverride(merged, overrides, "height")
  applyFieldOverride(merged, overrides, "seed")
  applyFieldOverride(merged, overrides, "steps")
  applyFieldOverride(merged, overrides, "cfg")
  applyFieldOverride(merged, overrides, "loras")
  return merged
}

function setInput(
  workflow: ApiWorkflow,
  mapping: FieldMapping | undefined,
  value: unknown
) {
  if (!mapping) return
  const node = workflow[mapping.nodeId]
  if (!node) return
  node.inputs[mapping.input] = value
}

function setNestedLora(
  node: ComfyNode,
  mapping: LoraMapping,
  value: LoraFormValue
) {
  const current = node.inputs[mapping.nameInput]
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {}
  node.inputs[mapping.nameInput] = {
    ...base,
    on: value.enabled,
    lora: value.name,
    strength: value.enabled ? value.strength : 0,
  }
}

export type PatchValues = {
  prompt: string
  duration: number
  width: number
  height: number
  seed: number
  firstFrameFilename?: string
  loras: LoraFormValue[]
  steps?: number
  cfg?: number
}

export function applyPatch(
  workflow: ApiWorkflow,
  mapping: WorkflowMapping,
  values: PatchValues
): ApiWorkflow {
  const next = structuredClone(workflow)
  setInput(next, mapping.prompt, values.prompt)
  setInput(next, mapping.width, values.width)
  setInput(next, mapping.height, values.height)
  setInput(next, mapping.seed, values.seed)

  if (mapping.duration) {
    if (mapping.durationUnit === "frames") {
      setInput(next, mapping.duration, secondsToH3Length(values.duration))
    } else {
      setInput(next, mapping.duration, values.duration)
    }
  }

  if (mapping.steps && values.steps !== undefined) {
    setInput(next, mapping.steps, values.steps)
  }
  if (mapping.cfg && values.cfg !== undefined) {
    setInput(next, mapping.cfg, values.cfg)
  }

  const seedNode = mapping.seed ? next[mapping.seed.nodeId] : undefined
  if (seedNode && seedNode.inputs.control_after_generate !== undefined) {
    seedNode.inputs.control_after_generate = "fixed"
  }

  if (values.firstFrameFilename && mapping.firstFrame) {
    setInput(next, mapping.firstFrame, values.firstFrameFilename)
  } else {
    for (const node of Object.values(next)) {
      if (H3_VIDEO_CLASSES.has(node.class_type)) {
        delete node.inputs.first_frame
        delete node.inputs.last_frame
      }
    }
  }

  for (const lora of values.loras) {
    const node = next[lora.nodeId]
    if (!node) continue
    const spec =
      mapping.loras.find((item) => item.nodeId === lora.nodeId) ?? {
        nodeId: lora.nodeId,
        nameInput: lora.nameInput,
        strengthInput: lora.strengthInput,
        nested: lora.nested,
      }
    if (spec.nested) {
      setNestedLora(node, spec, lora)
      continue
    }
    node.inputs[spec.nameInput] = lora.name
    node.inputs[spec.strengthInput] = lora.enabled ? lora.strength : 0
    if (node.inputs.strength_clip !== undefined) {
      node.inputs.strength_clip = lora.enabled ? lora.strength : 0
    }
  }

  return next
}

export function scalarInput(value: unknown): unknown {
  if (Array.isArray(value)) return undefined
  return value
}

export function extractValues(
  workflow: ApiWorkflow,
  mapping: WorkflowMapping
): {
  prompt: string
  duration: number
  width: number
  height: number
  aspect: string
  seed: number
  steps?: number
  cfg?: number
  loras: LoraFormValue[]
} {
  const promptRaw = mapping.prompt
    ? scalarInput(workflow[mapping.prompt.nodeId]?.inputs[mapping.prompt.input])
    : undefined
  const widthRaw = mapping.width
    ? scalarInput(workflow[mapping.width.nodeId]?.inputs[mapping.width.input])
    : undefined
  const heightRaw = mapping.height
    ? scalarInput(workflow[mapping.height.nodeId]?.inputs[mapping.height.input])
    : undefined
  const seedRaw = mapping.seed
    ? scalarInput(workflow[mapping.seed.nodeId]?.inputs[mapping.seed.input])
    : undefined
  const durationRaw = mapping.duration
    ? scalarInput(
        workflow[mapping.duration.nodeId]?.inputs[mapping.duration.input]
      )
    : undefined
  const stepsRaw = mapping.steps
    ? scalarInput(workflow[mapping.steps.nodeId]?.inputs[mapping.steps.input])
    : undefined
  const cfgRaw = mapping.cfg
    ? scalarInput(workflow[mapping.cfg.nodeId]?.inputs[mapping.cfg.input])
    : undefined

  const width = typeof widthRaw === "number" ? widthRaw : 1344
  const height = typeof heightRaw === "number" ? heightRaw : 768
  const preset = ASPECT_PRESETS.find(
    (item) => item.width === width && item.height === height
  )

  let duration = 5
  if (typeof durationRaw === "number") {
    duration =
      mapping.durationUnit === "frames"
        ? lengthToSeconds(durationRaw)
        : durationRaw
  }

  const loras: LoraFormValue[] = mapping.loras.map((lora) => {
    const node = workflow[lora.nodeId]
    if (!node) {
      return {
        nodeId: lora.nodeId,
        name: "",
        strength: 1,
        enabled: true,
        nested: Boolean(lora.nested),
        nameInput: lora.nameInput,
        strengthInput: lora.strengthInput,
      }
    }
    if (lora.nested) {
      const slot = node.inputs[lora.nameInput]
      const record =
        slot && typeof slot === "object" && !Array.isArray(slot)
          ? (slot as Record<string, unknown>)
          : {}
      const strength = typeof record.strength === "number" ? record.strength : 1
      return {
        nodeId: lora.nodeId,
        name: typeof record.lora === "string" ? record.lora : "",
        strength,
        enabled: record.on !== false && strength !== 0,
        nested: true,
        nameInput: lora.nameInput,
        strengthInput: lora.strengthInput,
      }
    }
    const name = scalarInput(node.inputs[lora.nameInput])
    const strengthRaw = scalarInput(node.inputs[lora.strengthInput])
    const strength = typeof strengthRaw === "number" ? strengthRaw : 1
    return {
      nodeId: lora.nodeId,
      name: typeof name === "string" ? name : "",
      strength,
      enabled: strength !== 0,
      nested: false,
      nameInput: lora.nameInput,
      strengthInput: lora.strengthInput,
    }
  })

  return {
    prompt: typeof promptRaw === "string" ? promptRaw : "",
    duration,
    width,
    height,
    aspect: preset?.id ?? "16:9",
    seed: typeof seedRaw === "number" ? seedRaw : 1,
    steps: typeof stepsRaw === "number" ? stepsRaw : undefined,
    cfg: typeof cfgRaw === "number" ? cfgRaw : undefined,
    loras,
  }
}

export function listMappableInputs(workflow: ApiWorkflow) {
  return Object.entries(workflow).map(([id, node]) => ({
    id,
    classType: node.class_type,
    title: nodeTitle(node),
    inputs: Object.keys(node.inputs),
  }))
}

export { H3_VIDEO_CLASSES, LORA_CLASSES, LOAD_IMAGE_CLASSES }

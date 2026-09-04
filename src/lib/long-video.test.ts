import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import {
  BUNDLED_WORKFLOWS,
  LONG_FLF_FILE,
  LONG_I2V_FILE,
  LONG_R2V_FILE,
  LONG_T2V_FILE,
  longWorkflowCapabilities,
} from "./default-workflows"
import {
  canChangeLockPrompt,
  canChangeLongWorkflow,
  emptyLongState,
  longWorkflowDisableReason,
  longWorkflowIncompatibility,
  mergeLockIntoPrompt,
  normalizeJob,
  patchLongChain,
} from "./long-video"
import type { ApiWorkflow, Job } from "./types"

function oldT2VJob(): Job {
  return {
    id: "old",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "awaiting",
    kind: "long",
    workflowFile: LONG_T2V_FILE,
    prompt: "",
    duration: 0,
    aspect: "16:9",
    width: 1344,
    height: 768,
    seed: 0,
    loras: [],
    clientId: "c",
    long: {
      lockPrompt: "a red jacket",
      finalized: false,
      aspectLocked: true,
      segments: [
        {
          index: 1,
          prompt: "walks",
          submittedPrompt: "a red jacket walks",
          duration: 5,
          seed: 1,
          status: "success",
        },
      ],
    },
  }
}

test("old long jobs default to t2v workflow and empty refs", () => {
  const job = normalizeJob(oldT2VJob())
  assert.equal(job.long?.workflowFile, LONG_T2V_FILE)
  assert.equal(job.long?.workflowKind, "t2v")
  assert.deepEqual(job.long?.publicLockRefs, [])
  assert.deepEqual(job.long?.segments[0]?.segmentRefs, [])
})

test("T2V stays available without references", () => {
  assert.equal(longWorkflowIncompatibility(LONG_T2V_FILE, {}), undefined)
  assert.equal(longWorkflowDisableReason(LONG_T2V_FILE, {}), undefined)
})

test("public image reference disables T2V", () => {
  const reason = longWorkflowDisableReason(LONG_T2V_FILE, {
    hasReferences: true,
    hasImageReference: true,
    referenceKinds: ["image"],
  })
  assert.equal(reason, "当前任务包含公共参考图片，不支持文生")
})

test("last frame disables workflows that cannot combine it with motion context", () => {
  const t2v = longWorkflowDisableReason(LONG_T2V_FILE, { hasLastFrame: true })
  assert.equal(t2v, "不支持当前段尾帧")
  const i2v = longWorkflowIncompatibility(LONG_I2V_FILE, { hasLastFrame: true })
  assert.equal(i2v, "不支持当前段尾帧")
})

test("validated long workflows stay selectable without conflicting media", () => {
  assert.equal(longWorkflowDisableReason(LONG_R2V_FILE, {}), undefined)
  assert.equal(BUNDLED_WORKFLOWS.some((item) => item.file === LONG_I2V_FILE), true)
  assert.equal(BUNDLED_WORKFLOWS.some((item) => item.file === LONG_FLF_FILE), true)
  assert.equal(longWorkflowCapabilities(LONG_I2V_FILE)?.validated, true)
  assert.equal(longWorkflowCapabilities(LONG_R2V_FILE)?.validated, true)
  assert.equal(longWorkflowCapabilities(LONG_FLF_FILE)?.validated, true)
})

test("workflow cannot change after any segment exists", () => {
  const job = normalizeJob(oldT2VJob())
  assert.equal(canChangeLongWorkflow(job), false)
  const fresh = normalizeJob({
    ...oldT2VJob(),
    long: emptyLongState("lock", LONG_T2V_FILE),
  })
  assert.equal(canChangeLongWorkflow(fresh), true)
})

test("lock prompt is frozen after job creation", () => {
  const created = normalizeJob({
    ...oldT2VJob(),
    long: emptyLongState("lock", LONG_T2V_FILE),
  })
  assert.equal(canChangeLockPrompt(created), false)
})

test("lock prompt merges into integrated_multimodal_description", () => {
  const merged = mergeLockIntoPrompt(
    "red jacket",
    "summary: a street\nintegrated_multimodal_description: walking"
  )
  assert.match(merged, /integrated_multimodal_description: red jacket walking/)
})

test("segment 1 does not load previous motion context", () => {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "templates/workflows/h3-t2v-long.json"),
    "utf8"
  )
  const workflow = JSON.parse(raw) as ApiWorkflow
  const patched = patchLongChain(workflow, {
    jobId: "job-1",
    clipIndex: 1,
    loadPrevious: false,
  })
  const classes = Object.values(patched).map((node) => node.class_type)
  assert.equal(classes.includes("MiniMaxH3MotionContextLoadLatent"), false)
  assert.equal(classes.includes("MiniMaxH3MotionContext"), false)
  const save = Object.values(patched).find(
    (node) => node.class_type === "MiniMaxH3MotionContextSaveLatent"
  )
  assert.equal(save?.inputs.clip_index, 1)
  assert.equal(save?.inputs.filename_prefix, "h3_studio/job-1/clip")
  const guider = Object.values(patched).find((node) => node.class_type === "BasicGuider")
  assert.deepEqual(guider?.inputs.conditioning, ["104", 0])
})

test("segment 2 loads previous motion context and saves the new clip", () => {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "templates/workflows/h3-t2v-long.json"),
    "utf8"
  )
  const workflow = JSON.parse(raw) as ApiWorkflow
  const patched = patchLongChain(workflow, {
    jobId: "job-1",
    clipIndex: 2,
    loadPrevious: true,
  })
  const load = Object.values(patched).find(
    (node) => node.class_type === "MiniMaxH3MotionContextLoadLatent"
  )
  const motion = Object.entries(patched).find(
    ([, node]) => node.class_type === "MiniMaxH3MotionContext"
  )
  const save = Object.values(patched).find(
    (node) => node.class_type === "MiniMaxH3MotionContextSaveLatent"
  )
  const guider = Object.values(patched).find((node) => node.class_type === "BasicGuider")
  assert.equal(load?.inputs.clip_index, 1)
  assert.equal(load?.inputs.latent_path, "h3_studio/job-1")
  assert.equal(save?.inputs.clip_index, 2)
  assert.ok(motion)
  assert.deepEqual(motion?.[1].inputs.context_latent, [
    Object.entries(patched).find(([, node]) => node.class_type === "MiniMaxH3MotionContextLoadLatent")?.[0],
    0,
  ])
  assert.deepEqual(guider?.inputs.conditioning, [motion?.[0], 0])
})

test("T2V capabilities do not claim reference or frame support", () => {
  const caps = longWorkflowCapabilities(LONG_T2V_FILE)
  assert.equal(caps?.validated, true)
  assert.deepEqual(caps?.publicReferenceKinds, [])
  assert.equal(caps?.supportsFirstFrame, false)
  assert.equal(caps?.supportsLastFrame, false)
})

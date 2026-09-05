import assert from "node:assert/strict"
import test from "node:test"
import {
  LONG_FLF_FILE,
  LONG_I2V_FILE,
  LONG_R2V_FILE,
  LONG_T2V_FILE,
  longWorkflowCapabilities,
} from "./default-workflows"
import {
  h3RefInputKeys,
  mergeLongRefs,
  storedMediaForSegment,
  validateLongCreateMedia,
  validateLongSegmentMedia,
} from "./long-media"
import type { Job, StoredInputMedia } from "./types"

const publicImage: StoredInputMedia = {
  slotId: "refImage:0",
  file: "public-a.png",
  originalName: "a.png",
  contentType: "image/png",
  kind: "image",
  index: 0,
  scope: "public",
  role: "refImage",
}

const segmentImage: StoredInputMedia = {
  slotId: "refImage:0",
  file: "seg-b.png",
  originalName: "b.png",
  contentType: "image/png",
  kind: "image",
  index: 0,
  scope: "segment",
  segmentIndex: 2,
  role: "refImage",
}

test("public refs stay in front and are not overwritten by segment refs", () => {
  const merged = mergeLongRefs([publicImage], [segmentImage])
  assert.equal(merged.length, 2)
  assert.equal(merged[0]?.file, "public-a.png")
  assert.equal(merged[0]?.index, 0)
  assert.equal(merged[1]?.file, "seg-b.png")
  assert.equal(merged[1]?.index, 1)
  assert.equal(merged[1]?.slotId, "refImage:1")
})

test("segment refs do not leak into another segment", () => {
  const job = {
    workflowFile: LONG_R2V_FILE,
    long: {
      workflowFile: LONG_R2V_FILE,
      lockPrompt: "",
      publicLockRefs: [publicImage],
      finalized: false,
      aspectLocked: true,
      segments: [
        {
          index: 1,
          prompt: "one",
          submittedPrompt: "one",
          duration: 5,
          seed: 1,
          status: "success" as const,
          segmentRefs: [],
        },
        {
          index: 2,
          prompt: "two",
          submittedPrompt: "two",
          duration: 5,
          seed: 2,
          status: "waiting" as const,
          segmentRefs: [segmentImage],
        },
      ],
    },
  } as unknown as Job
  const first = storedMediaForSegment(job, 1)
  const second = storedMediaForSegment(job, 2)
  assert.equal(first.some((item) => item.file === "seg-b.png"), false)
  assert.equal(second.some((item) => item.file === "seg-b.png"), true)
  assert.equal(second.some((item) => item.file === "public-a.png"), true)
})

test("create media validation rejects public refs on T2V", () => {
  const error = validateLongCreateMedia({
    workflowFile: LONG_T2V_FILE,
    publicRefs: [publicImage],
  })
  assert.equal(error, "当前任务包含公共参考图片，不支持文生")
})

test("I2V segment 1 requires a first frame and later segments reject it", () => {
  const caps = longWorkflowCapabilities(LONG_I2V_FILE)!
  const missing = validateLongSegmentMedia({
    capabilities: caps,
    clipIndex: 1,
    publicRefs: [],
    segmentRefs: [],
  })
  assert.equal(missing, "第 1 段需要首帧")
  const later = validateLongSegmentMedia({
    capabilities: caps,
    clipIndex: 2,
    publicRefs: [],
    segmentRefs: [],
    firstFrame: {
      slotId: "firstFrame",
      file: "frame.png",
      originalName: "frame.png",
      contentType: "image/png",
      kind: "image",
      role: "firstFrame",
    },
  })
  assert.equal(later, "后续段首帧由 Motion Context 提供，不要再上传首帧")
})

test("FLF segment 1 can take first and last frames together", () => {
  const caps = longWorkflowCapabilities(LONG_FLF_FILE)!
  const error = validateLongSegmentMedia({
    capabilities: caps,
    clipIndex: 1,
    publicRefs: [],
    segmentRefs: [],
    firstFrame: {
      slotId: "firstFrame",
      file: "start.png",
      originalName: "start.png",
      contentType: "image/png",
      kind: "image",
      role: "firstFrame",
    },
    lastFrame: {
      slotId: "lastFrame",
      file: "end.png",
      originalName: "end.png",
      contentType: "image/png",
      kind: "image",
      role: "lastFrame",
    },
  })
  assert.equal(error, undefined)
})

test("R2V submitted graphs keep public audio and video refs on the H3 node", () => {
  const keys = h3RefInputKeys({
    "136": {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        "ref_images.ref_image_0": ["301", 0],
        "ref_videos.ref_video_0": ["302", 0],
        "ref_audios.ref_audio_0": ["303", 0],
      },
    },
  })
  assert.deepEqual(keys.images, ["ref_images.ref_image_0"])
  assert.deepEqual(keys.videos, ["ref_videos.ref_video_0"])
  assert.deepEqual(keys.audios, ["ref_audios.ref_audio_0"])
})

test("R2V allows public audio or video without an image", () => {
  const audio: StoredInputMedia = {
    slotId: "refAudio:0",
    file: "a.wav",
    originalName: "a.wav",
    contentType: "audio/wav",
    kind: "audio",
    index: 0,
    scope: "public",
    role: "refAudio",
  }
  const video: StoredInputMedia = {
    slotId: "refVideo:0",
    file: "v.mp4",
    originalName: "v.mp4",
    contentType: "video/mp4",
    kind: "video",
    index: 0,
    scope: "public",
    role: "refVideo",
  }
  assert.equal(validateLongCreateMedia({ workflowFile: LONG_R2V_FILE, publicRefs: [audio] }), undefined)
  assert.equal(validateLongCreateMedia({ workflowFile: LONG_R2V_FILE, publicRefs: [video] }), undefined)
})

test("FLF last frame on later segments requires motion-context compatibility", () => {
  const caps = longWorkflowCapabilities(LONG_FLF_FILE)!
  const ok = validateLongSegmentMedia({
    capabilities: caps,
    clipIndex: 2,
    publicRefs: [],
    segmentRefs: [],
    lastFrame: {
      slotId: "lastFrame",
      file: "end.png",
      originalName: "end.png",
      contentType: "image/png",
      kind: "image",
      role: "lastFrame",
    },
  })
  assert.equal(caps.supportsMotionContextWithLastFrame, true)
  assert.equal(ok, undefined)
})

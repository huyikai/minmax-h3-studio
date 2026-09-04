# 长视频多工作流验证记录

分支：`feat/long-video-workflows`

本轮提交（文档提交前）：

- `6be985d` Add long-video media scope and capability validation
- `6870657` Add validated I2V long-video workflow
- `3878b13` Add validated R2V long-video workflow
- `5543a09` Add validated FLF long-video workflow

验证时间：2026-09-04，本机真实 ComfyUI（未使用 `pnpm dev:mock`）。

Studio：`http://127.0.0.1:17333`

## 环境

| 项 | 值 |
| --- | --- |
| ComfyUI | 0.33.0（`deploy_environment: local-git`） |
| GPU | NVIDIA GeForce RTX 5070 Ti，约 16 GB |
| 显存（验证开始时空闲） | 约 9.2 GB |
| Python | 3.12.10 |
| PyTorch | 2.13.0+cu130 |
| MiniMax H3 节点 | `MiniMaxH3ImageToVideo`、`MiniMaxH3ReferenceToVideo` 均存在 |
| Motion Context | `ComfyUI-H3-Motion-Context` 0.4.0；`MiniMaxH3MotionContext` / `Trim` / `SaveLatent` / `LoadLatent` 均存在 |
| FL2VA | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` |
| Ref2VA | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` |
| Video VAE | `minimax_h3_video_vae_fp16.safetensors` |
| Audio VAE | `minimax_h3_audio_vae_fp32.safetensors` |
| CLIP | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |

验证参数（为在本机显存内连续跑完四套两段链）：步数 16，0.4 MP（864×480），时长 5s，画幅 16:9。

公共锁定文本：

```text
A woman in a crimson jacket and short black hair, daylight, handheld camera.
```

输入素材：`ffmpeg` 生成的 1280×720 PNG（`testsrc` 首帧、纯色尾帧、纯色参考图）。不提交到仓库。

## API 锁定

| 检查 | 状态 | 说明 |
| --- | --- | --- |
| 创建任务后改公共锁定文本 | PASS | `POST /api/jobs/:id/segments` 带不同 `lockPrompt` → 409「公共锁定已冻结，不能修改」 |
| 已有片段后切换工作流 | PASS | `PUT /api/jobs/:id/workflow` → 409「已有片段后不能切换工作流」 |
| 尚无片段时可切换工作流 | PASS | 创建后、提交第 1 段前切换到 `h3-i2v-long.json` 成功 |

## 工作流结果

### 长视频 · 文生链 `h3-t2v-long.json`

状态：**PASS**（回归）

- 任务：`efc27f54-1452-4245-8278-9dfa331ffe3c`
- 组合：无参考、无首尾帧
- 第 1 段：PASS。无 Load Latent；Save `clip_index=1`；锁定写入 `integrated_multimodal_description`
- 第 2 段：PASS。Load `clip_index=1`，`latent_path=h3_studio/<jobId>`；Motion Context 接 Load；Guider 接 Motion Context；Save `clip_index=2`
- Motion Context：PASS
- 公共锁定：PASS（两段 prompt 均含 crimson jacket / short black hair）
- 参考元素：不适用
- 首尾帧：不适用
- 拼接：PASS `outputs/efc27f54-1452-4245-8278-9dfa331ffe3c/stitched.mp4`
- 视觉连续：PASS。第 1 段尾帧与第 2 段首帧为同一红夹克短发女性、同一条空街，朝向和光比连续
- JSON：`outputs/<job>/workflow-seg001.json`、`workflow-seg002.json`

### 长视频 · 图生链 `h3-i2v-long.json`

状态：**PASS**

- 任务：`68265955-a5ca-4599-b2ea-0eb08481c360`
- 组合：第 1 段首帧；第 2 段仅 Motion Context（不再上传首帧）
- 第 1 段：PASS。`MiniMaxH3ImageToVideo.first_frame` 已接；无 Load Latent
- 第 2 段：PASS。仍是 `MiniMaxH3ImageToVideo`（未降级成 T2V 图）；无 `first_frame`；Load + Motion Context + Save `clip_index=2`
- Motion Context：PASS
- 公共锁定：PASS
- 首帧：PASS（只在第 1 段）
- 尾帧：不适用
- 拼接：PASS
- 视觉连续：PASS。两段同一人物（红/栗色外套、黑色齐刘海、郊区街道、银色轿车）
- JSON：`outputs/68265955-a5ca-4599-b2ea-0eb08481c360/workflow-seg00{1,2}.json`

### 长视频 · 参考生链 `h3-r2v-long.json`

状态：**PASS**（图片参考 + Motion Context）

- 任务：`922e6555-58d6-4a31-85b8-31682912dfc6`
- 组合：创建时公共参考图；第 2 段另加本段参考图
- UNET：`minimax_h3_ref2va_pruned_int8_convrot.safetensors`
- 第 1 段：PASS。`MiniMaxH3ReferenceToVideo` + `ref_images.ref_image_0`；无 Load
- 第 2 段：PASS。同一 Reference 节点；`ref_image_0`（公共）+ `ref_image_1`（本段）；Motion Context 的 conditioning/latent 来自节点 `136`
- 公共锁定：PASS
- 公共参考：PASS，每段自动注入
- 本段参考：PASS，只出现在第 2 段
- 拼接：PASS
- 视觉连续：PASS。红西装、短发、同一条郊区街道与白巴士/银车位置衔接。第 1 段尾帧底部有一层模型烧字，接缝人物与场景仍连续
- 音频参考连续段：NOT RUN
- 视频参考连续段：NOT RUN

### 长视频 · 首尾帧链 `h3-flf-long.json`

状态：**PASS**（第 1 段仅首帧；第 2 段 Motion Context + 当前段尾帧）

- 任务：`762bd58b-447c-4a8e-93de-e0e5c18769a7`
- 第 1 段：PASS。`first_frame` 已接，无 `last_frame`，无 Load
- 第 2 段：PASS。无 `first_frame`；`last_frame` 接到 `LoadImage` `121`；同时 Load Latent + Motion Context。节点说明会保留 last_frame anchor，实际生成成功
- `supportsMotionContextWithLastFrame`：true（已真实验证，未关闭）
- 拼接：PASS
- 视觉连续：PASS。红大衣、灰色高领、红砖街与停靠车辆在接缝两侧一致
- 未跑组合：
  - 第 1 段首帧+尾帧：NOT RUN
  - 第 2 段 Motion Context、无尾帧：NOT RUN

## 未跑 / 未声称支持

| 项 | 状态 | 原因 |
| --- | --- | --- |
| R2V 公共/本段音频 | NOT RUN | 本轮只验证了图片参考与 Motion Context 同时工作。代码已按限额接入音频，但没有两段真实音频链 |
| R2V 视频参考 | NOT RUN | 同上 |
| FLF 第 1 段同时首尾帧 | NOT RUN | 已验证「仅首帧」以及「第 2 段 MC+尾帧」 |
| 重写第 1 段后重建 Context 链 | NOT RUN | 服务端仍按原逻辑 void 后续段；本轮未再烧一张 GPU 重做 |
| 0.98 MP / 20 步生产档 | NOT RUN | 本机连续四套两段链使用 0.4 MP / 16 步以避免显存排队过长 |

短视频原始 JSON 未改：`h3-t2v.json`、`h3-i2v.json`、`h3-r2v.json`、`h3-flf.json`。

## 失败

无。本轮没有 `FAIL` 的两段链。

过程中 `data/jobs.json` 在 Windows 上偶发 `EPERM rename`。已改为 `copyFile` 重试写入，验证后半段进度与完成状态正常。

## 阻塞

无。节点、权重、GPU 均可用。ComfyUI 版本是 0.33.0，低于文档里的 Motion Context 建议 0.34.0，但节点已加载且四套链均生成成功。

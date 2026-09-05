# 长视频多工作流验证记录

分支：`feat/long-video-workflows`

本轮提交（文档提交前）：

- `6be985d` Add long-video media scope and capability validation
- `6870657` Add validated I2V long-video workflow
- `3878b13` Add validated R2V long-video workflow
- `5543a09` Add validated FLF long-video workflow

验证时间：2026-09-04。第一轮白天，第二轮晚上。本机真实 ComfyUI（未使用 `pnpm dev:mock`）。

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
- 音频参考连续段：见第二轮
- 视频参考连续段：见第二轮

### 长视频 · 首尾帧链 `h3-flf-long.json`

状态：**PASS**（第 1 段仅首帧；第 2 段 Motion Context + 当前段尾帧）

- 任务：`762bd58b-447c-4a8e-93de-e0e5c18769a7`
- 第 1 段：PASS。`first_frame` 已接，无 `last_frame`，无 Load
- 第 2 段：PASS。无 `first_frame`；`last_frame` 接到 `LoadImage` `121`；同时 Load Latent + Motion Context。节点说明会保留 last_frame anchor，实际生成成功
- `supportsMotionContextWithLastFrame`：true（已真实验证，未关闭）
- 拼接：PASS
- 视觉连续：PASS。红大衣、灰色高领、红砖街与停靠车辆在接缝两侧一致
- 第二轮补跑：见下方「第 1 段首帧+尾帧 → 第 2 段仅 Motion Context」

## 第二轮（2026-09-04 晚）

脚本：`scripts/validate-long-remaining.mjs`。Studio 为重启后的 `pnpm dev`（非 mock）。参数仍为 16 步、0.4 MP、5s。

### R2V 公共图 + 公共音频

状态：**PASS**

- 任务：`baf8811b-e020-4215-9599-f3747b6a4023`
- 组合：创建时公共参考图 + 公共参考 wav（sine 440 Hz / 32 kHz）
- 第 1 段：PASS。`MiniMaxH3ReferenceToVideo`；`ref_images.ref_image_0` + `ref_audios.ref_audio_0`；`LoadAudio` 存在；无 Load Latent
- 第 2 段：PASS。同一公共图和公共音频再次注入；Load `clip_index=1`；Save `clip_index=2`
- 输出音轨：两段均为 AAC 32 kHz（与 Motion Context 音频时钟一致）
- 公共锁定：PASS
- 拼接：PASS
- 视觉连续：PASS。接缝两侧均为短发、深红夹克、林荫空路、浅景深

### R2V 公共图 + 公共视频

状态：**PASS**

- 任务：`8df172ab-9aa8-4d7f-a8e7-675a8c205d57`
- 组合：创建时公共参考图 + 公共参考 mp4
- 第 1 段：PASS。`ref_images.ref_image_0` + `ref_videos.ref_video_0`；`LoadVideo` 存在
- 第 2 段：PASS。公共图和公共视频再次注入；Motion Context 从上一镜 Load
- 拼接：PASS
- 视觉连续：PASS。红大衣、黑白横纹内搭、斜挎带、石墙铁门与行道树在接缝两侧一致

### FLF 第 1 段首帧+尾帧 → 第 2 段仅 Motion Context

状态：**PASS**（生成、图结构、按尾帧切镜）

- 任务：`2cb79e64-77bf-481b-bd31-b7c4059f6e70`
- 第 1 段：PASS。`first_frame` 与 `last_frame` 均已接。抽出的首帧是 testsrc 彩条，尾帧是纯色尾帧夹具 `0x1E3F8B`，说明首尾帧都写进了成片
- 第 2 段：PASS。无 `first_frame`、无 `last_frame`；Load + Motion Context + Save `clip_index=2`
- 拼接文件：PASS `stitched.mp4`
- 镜头：切镜，符合尾帧。第 1 段收到纯蓝场，第 2 段按新提示词回到人物与街道。长视频允许切镜或一镜到底，由提示词和尾帧决定，不把切镜记成失败

### T2V 重写第 1 段后重建 Motion Context

状态：**PASS**

- 任务：`fbf672cf-5a1c-4ae6-b1b6-c6290c04cf7e`
- 先成功生成第 1、2 段，再 `redoIndex=1`
- 重写提交后第 2 段状态为 `voided`，第 1 段重新排队
- 重写后的第 1 段：PASS。无 Load；Save `clip_index=1`；prompt 含 shop window
- 重建第 2 段：PASS。Load `clip_index=1`，`latent_path=h3_studio/<jobId>`；Save `clip_index=2`
- 拼接：PASS
- 视觉连续：PASS。重写后两段仍是红夹克短发、橱窗玻璃与卷帘门同一条街

## 未跑 / 未声称支持

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 0.98 MP / 20 步生产档 | NOT RUN | 两轮真实链均使用 0.4 MP / 16 步 |
| R2V 仅音频、无参考图 | NOT RUN | 本轮音频链始终带公共参考图（身份） |
| R2V 仅视频、无参考图 | NOT RUN | 本轮视频链始终带公共参考图 |

短视频原始 JSON 未改：`h3-t2v.json`、`h3-i2v.json`、`h3-r2v.json`、`h3-flf.json`。

## 失败

无。本轮没有 `FAIL` 的生成链。FLF 尾帧后续写出现切镜，按提示词/尾帧视为通过，不记失败。

过程中 `data/jobs.json` 在 Windows 上偶发 `EPERM rename`。已改为 `copyFile` 重试写入，验证后半段进度与完成状态正常。

## 阻塞

无。节点、权重、GPU 均可用。ComfyUI 版本是 0.33.0，低于文档里的 Motion Context 建议 0.34.0，但节点已加载且四套链均生成成功。

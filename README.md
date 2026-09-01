# MiniMax H3 Studio

本地运行的视频创作界面。它不运行模型本身，而是把 MiniMax H3 工作流包成单页出片工具：写提示词、按当前图上传参考、看进度、把成片留在本机。

Studio 不会代装 ComfyUI。连上本机 Comfy 之后，可在设置「环境」里校验目录、复制长视频节点、下载或登记 H3 权重。

## 你需要先有什么

- Node.js 20+
- pnpm
- 本机正在运行的 ComfyUI（默认 `127.0.0.1:8188`，需要带 MiniMax H3 的版本）
- 量化剪枝版 FL2VA 权重（文生 / 图生 / 首尾帧）。可在设置「环境」里下载到 Comfy 的 `models/`，或登记已有目录
- 参考生还需要 Ref2VA 权重（`minimax_h3_ref2va_pruned_int8_convrot.safetensors`）
- 若用 Turbo：加速 LoRA，以及 [ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) 自定义节点（Studio 这轮不代装）
- 长视频：设置「环境」会把内置的 Motion Context 节点复制进 `custom_nodes`，然后请你重启 ComfyUI

## 启动

```bash
pnpm install
pnpm dev
```

浏览器打开 [http://127.0.0.1:17333](http://127.0.0.1:17333)。

生产模式：

```bash
pnpm build
pnpm start
```

## 默认工作流

Studio 自带六份 **API 格式**预设。文生 / 图生 / 首尾帧的上传区只显示当前图里真正接上的口；参考生是一份图，下面按需要加参考：

| 下拉名称 | 文件 | 说明 |
| --- | --- | --- |
| 官方 · 文生 | `h3-t2v.json` | 20 步，无上传 |
| 官方 · 图生 | `h3-i2v.json` | 20 步，首帧 |
| 官方 · 首尾帧 | `h3-flf.json` | 20 步，首帧 + 尾帧 |
| Turbo · 文生 | `h3-t2v-turbo.json` | 6 步 + Turbo LoRA |
| Turbo · 图生 | `h3-i2v-turbo.json` | 6 步 + 首帧 |
| 官方 · 参考生 | `h3-r2v.json` | Ref2VA。可加参考图 / 视频 / 音频，最多 9 / 3 / 3 |

参考生提示词按 [Comfy 官方说明](https://docs.comfy.org/zh/tutorials/video/minimax/minimax-h3) 用 `<Picture 1>`、`<Video 1>`、`<Audio 1>` 按类型顺序引用，并给每个参考分配任务。

不收录：

| 未收录 | 原因 |
| --- | --- |
| `t2v_8gb` | 和官方文生同一张图，把步数改成 15 即可 |
| `i2v_easycache` | EasyCache 是实验性加速，Studio 不暴露 cache 参数 |

还可以在设置里上传自己的 API JSON。上传与预设同名的文件会覆盖该预设；删掉覆盖即恢复。

常见会被自动识别的节点：

| 用途 | 节点 |
| --- | --- |
| 提示词 / 分辨率 / 帧数 | `MiniMaxH3ImageToVideo` / `MiniMaxH3ReferenceToVideo` |
| 时长（秒） | 标题含 duration 的 `PrimitiveFloat` |
| 首帧 / 尾帧 | 接到 `first_frame` / `last_frame` 的 `LoadImage` |
| 参考 | `MiniMaxH3ReferenceToVideo`：界面按限额添加，提交时再接线 |
| Seed | `RandomNoise` / `KSampler` |
| 步数 | `BasicScheduler` |
| LoRA | `LoraLoader` / `LoraLoaderModelOnly` / `MiniMaxH3TurboLoRA` / rgthree Power LoRA |

识别不对就在设置里改映射，只对当前这份 JSON 生效。

## ComfyUI 连接

Studio 的 Node 服务端代理 ComfyUI，浏览器不必开 CORS。默认只连本机 `127.0.0.1:8188`，端口可在设置里改。

逃生口：顶栏「打开 ComfyUI」，以及每条任务的「本次 JSON」（实际提交给 `/prompt` 的图）。

## 数据放哪

| 路径 | 内容 |
| --- | --- |
| `templates/workflows/` | 随仓库发布的官方 / Turbo 预设 |
| `workflows/` | 你上传或覆盖的 API JSON |
| `outputs/<任务id>/` | 复制过来的成片和本次 workflow |
| `data/` | 端口、映射、任务元数据 |

`workflows/`、`outputs/`、`data/` 已加入 gitignore。

## 没有 GPU 时预览界面

仓库带了一个假 ComfyUI，只用于看界面和走通提交/进度/成片复制，不能当真出片：

```bash
pnpm mock:comfy
```

它听 `8188`。另开一个终端跑 `pnpm dev` 即可点生成。这份 mock 不会真跑 H3。

## 技术栈

Next.js App Router、TypeScript、Tailwind、shadcn/ui。包管理用 pnpm。

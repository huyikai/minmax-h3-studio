# MiniMax H3 Studio

本地运行的视频创作界面。它不运行模型本身，而是把你已经在 ComfyUI 里跑通的 MiniMax H3 工作流（量化剪枝 + 加速 LoRA 那一类）包成单页出片工具：写提示词、可选首帧、看进度、把成片留在本机。

适合已经在本机部署了 MiniMax H3 + ComfyUI 的人。Studio 不会代装 ComfyUI，也不会代下模型。

## 你需要先有什么

- Node.js 20+
- pnpm
- 本机正在运行的 ComfyUI（默认 `127.0.0.1:8188`）
- 一份能出片的 MiniMax H3 **API 格式** workflow JSON

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

## 导入工作流

1. 在 ComfyUI 打开你的 H3 图。
2. **文件 → 导出（API）**。画布 JSON 无法提交到 `/prompt`。
3. 把文件放到仓库的 `workflows/` 目录，或在 Studio 设置里上传。
4. 主界面选择该文件。没有图就是 T2V；放了首帧且工作流里有 LoadImage，就会走 I2V。

常见会被自动识别的节点：

| 用途 | 节点 |
| --- | --- |
| 提示词 / 分辨率 / 帧数 | `MiniMaxH3ImageToVideo` |
| 时长（秒） | 标题含 duration 的 `PrimitiveFloat` |
| 首帧 | `LoadImage` |
| Seed | `RandomNoise` / `KSampler` |
| 步数 | `BasicScheduler` |
| LoRA | `LoraLoader` / `LoraLoaderModelOnly` / rgthree Power LoRA |

识别不对就在设置里改映射，只对当前这份 JSON 生效。

## ComfyUI 连接

Studio 的 Node 服务端代理 ComfyUI，浏览器不必开 CORS。默认只连本机 `127.0.0.1:8188`，端口可在设置里改。

逃生口：顶栏「打开 ComfyUI」，以及每条任务的「本次 JSON」（实际提交给 `/prompt` 的图）。

## 数据放哪

| 路径 | 内容 |
| --- | --- |
| `workflows/` | 你的 API JSON |
| `outputs/<任务id>/` | 复制过来的成片和本次 workflow |
| `data/` | 端口、映射、任务元数据 |

这些目录已加入 gitignore。

## 没有 GPU 时预览界面

仓库带了一个假 ComfyUI，只用于看界面和走通提交/进度/成片复制，不能当真出片：

```bash
pnpm mock:comfy
```

它听 `8188`。另开一个终端跑 `pnpm dev`，可把 `scripts/sample-api-workflow.json` 复制到 `workflows/` 后点生成。这份 JSON 只演示 API 结构，不是能在真 H3 上跑的完整图。

## 技术栈

Next.js App Router、TypeScript、Tailwind、shadcn/ui。包管理用 pnpm。

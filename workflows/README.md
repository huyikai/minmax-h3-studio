# 工作流目录

把你在 ComfyUI 里已经跑通的 MiniMax H3 图导出到这里。

1. 打开 ComfyUI，加载量化剪枝 + 加速 LoRA 的工作流。
2. 菜单选择 **文件 → 导出（API）**，不要导出画布格式。
3. 把 JSON 放到这个目录，或在 Studio 设置页上传。
4. 可以放多份，例如 `t2v.json` 和 `i2v.json`，在主界面下拉切换。

Studio 会按节点类型自动识别提示词、时长、seed、LoRA 和 LoadImage。认错时到设置里改映射。

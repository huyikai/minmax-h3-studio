"use client"

import type { Dispatch, SetStateAction } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import {
  Field,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { LabelWithHelp } from "@/components/studio/field-help"
import { MediaSlots, type SlotFile } from "@/components/studio/media-slots"
import {
  ReferenceSlots,
  type RefDraft,
} from "@/components/studio/reference-slots"
import type { LoraFormValue, MediaKind, MediaSlot } from "@/lib/types"
import { ASPECT_PRESETS, DURATION_OPTIONS } from "@/lib/types"
import {
  clampLoraStrength,
  loraKind,
  loraStrengthMax,
} from "@/lib/lora"
import type { WorkflowListItem } from "@/lib/default-workflows"
import { cn } from "@/lib/utils"

const PROMPT_PLACEHOLDER = "聚焦后右侧显示写法"

type GroupedWorkflows = {
  official: WorkflowListItem[]
  turbo: WorkflowListItem[]
  reference: WorkflowListItem[]
  custom: WorkflowListItem[]
}

export function ComposeForm({
  readOnly,
  workflows,
  workflowName,
  grouped,
  currentWorkflow,
  mappingHints,
  prompt,
  promptHint,
  textareaRef,
  duration,
  aspect,
  seed,
  randomize,
  steps,
  cfg,
  loras,
  loraFiles,
  hasSteps,
  hasCfg,
  mediaSlots,
  slotFiles,
  dynamicRefs,
  refDrafts,
  onWorkflowChange,
  onPromptChange,
  onPromptFocus,
  onDurationChange,
  onAspectChange,
  onSeedChange,
  onRandomizeChange,
  onStepsChange,
  onCfgChange,
  onLorasChange,
  onSlotFile,
  onAddRefs,
  onRemoveRef,
}: {
  readOnly: boolean
  workflows: WorkflowListItem[]
  workflowName: string
  grouped: GroupedWorkflows
  currentWorkflow?: WorkflowListItem
  mappingHints: string[]
  prompt: string
  promptHint: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  duration: string
  aspect: string
  seed: number
  randomize: boolean
  steps: string
  cfg: string
  loras: LoraFormValue[]
  loraFiles: string[]
  hasSteps: boolean
  hasCfg: boolean
  mediaSlots: MediaSlot[]
  slotFiles: Record<string, SlotFile>
  dynamicRefs: boolean
  refDrafts: RefDraft[]
  onWorkflowChange: (name: string) => void
  onPromptChange: (value: string) => void
  onPromptFocus?: () => void
  onDurationChange: (value: string) => void
  onAspectChange: (value: string) => void
  onSeedChange: (value: number) => void
  onRandomizeChange: (value: boolean) => void
  onStepsChange: (value: string) => void
  onCfgChange: (value: string) => void
  onLorasChange: Dispatch<SetStateAction<LoraFormValue[]>>
  onSlotFile: (slotId: string, file: File | null) => void
  onAddRefs: (kind: MediaKind, files: File[]) => void
  onRemoveRef: (id: string) => void
}) {
  return (
    <div
      className={cn(readOnly && "pointer-events-none opacity-60")}
      aria-disabled={readOnly}
    >
      {workflows.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有可用的工作流。请到设置里上传 API JSON。</p>
      ) : (
        <FieldGroup>
          <Field>
            <LabelWithHelp label="工作流">
              官方 20 步、Turbo 6 步，或参考生（另一套 Ref2VA 权重）。上传区随当前图上的节点出现。
            </LabelWithHelp>
            <Select
              value={workflowName}
              onValueChange={onWorkflowChange}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择工作流" />
              </SelectTrigger>
              <SelectContent>
                {grouped.official.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>官方</SelectLabel>
                    {grouped.official.map((item) => (
                      <SelectItem key={item.name} value={item.name}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {grouped.turbo.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>Turbo LoRA</SelectLabel>
                    {grouped.turbo.map((item) => (
                      <SelectItem key={item.name} value={item.name}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {grouped.reference.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>参考生</SelectLabel>
                    {grouped.reference.map((item) => (
                      <SelectItem key={item.name} value={item.name}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {grouped.custom.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>我的</SelectLabel>
                    {grouped.custom.map((item) => (
                      <SelectItem key={item.name} value={item.name}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
            <FieldDescription>
              {[
                currentWorkflow?.description,
                mappingHints.length
                  ? `已识别：${mappingHints.join("、")}`
                  : "未识别到常用字段，请到设置里手动映射",
              ]
                .filter(Boolean)
                .join(" ")}
            </FieldDescription>
          </Field>

          <Field>
            <div className="flex items-baseline justify-between gap-3">
              <LabelWithHelp htmlFor="prompt" label="提示词">
                正文建议英文。对白、歌词、画面上的字保留原文。观众配乐写在
                non_diegetic_music，没有就写 N/A。
              </LabelWithHelp>
              <span
                className="font-mono text-[11px] tabular-nums text-muted-foreground"
                aria-label={`字数 ${prompt.length}`}
              >
                {prompt.length}
              </span>
            </div>
            <Textarea
              ref={textareaRef}
              id="prompt"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onFocus={onPromptFocus}
              placeholder={PROMPT_PLACEHOLDER}
              aria-describedby="prompt-hint"
              className="min-h-44"
              disabled={readOnly}
            />
            <FieldDescription id="prompt-hint">{promptHint}</FieldDescription>
          </Field>

          <MediaSlots slots={mediaSlots} files={slotFiles} onChange={onSlotFile} />

          {dynamicRefs ? (
            <ReferenceSlots
              drafts={refDrafts}
              onAdd={onAddRefs}
              onRemove={onRemoveRef}
            />
          ) : null}

          <Field>
            <LabelWithHelp label="时长">
              成片大约几秒，会写入工作流的时长或帧数。13-15 秒要有一条清楚的动作推进。
            </LabelWithHelp>
            <ToggleGroup
              type="single"
              value={duration}
              onValueChange={(value) => {
                if (value) onDurationChange(value)
              }}
              variant="outline"
              size="sm"
              className="flex-wrap"
              disabled={readOnly}
            >
              {DURATION_OPTIONS.map((item) => (
                <ToggleGroupItem
                  key={item}
                  value={String(item)}
                  className="font-mono tabular-nums data-[state=on]:border-primary/70 data-[state=on]:bg-primary/15"
                >
                  {item}s
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <LabelWithHelp label="画幅">
              画面比例，对应工作流里的宽和高。选了会覆盖 JSON 里原来的分辨率。
            </LabelWithHelp>
            <ToggleGroup
              type="single"
              value={aspect}
              onValueChange={(value) => {
                if (value) onAspectChange(value)
              }}
              variant="outline"
              size="sm"
              className="flex-wrap"
              disabled={readOnly}
            >
              {ASPECT_PRESETS.map((item) => (
                <ToggleGroupItem
                  key={item.id}
                  value={item.id}
                  className="font-mono data-[state=on]:border-primary/70 data-[state=on]:bg-primary/15"
                >
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <LabelWithHelp htmlFor="seed" label="Seed">
              这是这次成片的编号。数字大小没有好坏，换一个等于重新抽一次构图和口气；提示词和参数不变时，同一个编号更容易长得像。默认每次换编号。看中了就关掉「随机」，锁住框里刚生成用过的那个数；或者打开那条任务的详情，再生成就不会另抽。
            </LabelWithHelp>
            <div className="flex items-center gap-2">
              <Input
                id="seed"
                className="font-mono tabular-nums"
                inputMode="numeric"
                value={seed}
                onChange={(event) => onSeedChange(Number(event.target.value) || 0)}
                disabled={readOnly || randomize}
              />
              <div className="flex items-center gap-2 whitespace-nowrap text-sm">
                <Switch
                  checked={randomize}
                  onCheckedChange={onRandomizeChange}
                  id="randomize"
                  disabled={readOnly}
                />
                <label htmlFor="randomize">随机</label>
              </div>
            </div>
          </Field>

          {hasSteps || hasCfg ? (
            <div
              className={cn(
                "grid gap-3",
                hasSteps && hasCfg ? "grid-cols-2" : "grid-cols-1"
              )}
            >
              {hasSteps ? (
                <Field>
                  <LabelWithHelp htmlFor="steps" label="步数">
                    采样步数。开了加速 LoRA 时偶尔要改，一般留空用工作流默认。
                  </LabelWithHelp>
                  <Input
                    id="steps"
                    className="font-mono tabular-nums"
                    value={steps}
                    onChange={(event) => onStepsChange(event.target.value)}
                    placeholder="工作流默认"
                    disabled={readOnly}
                  />
                </Field>
              ) : null}
              {hasCfg ? (
                <Field>
                  <LabelWithHelp htmlFor="cfg" label="CFG">
                    提示词约束强度。越大越听 prompt，太高容易发硬、不自然。常见默认约
                    7。
                  </LabelWithHelp>
                  <Input
                    id="cfg"
                    className="font-mono tabular-nums"
                    value={cfg}
                    onChange={(event) => onCfgChange(event.target.value)}
                    placeholder="工作流默认"
                    disabled={readOnly}
                  />
                </Field>
              ) : null}
            </div>
          ) : null}

          {loras.length > 0 ? (
            <FieldGroup>
              {loras.map((lora, index) => {
                const kind = loraKind(lora)
                const turbo = kind === "turbo"
                const max = loraStrengthMax(kind)
                const strength = clampLoraStrength(lora)
                return (
                  <Field key={`${lora.nodeId}-${index}`}>
                    <LabelWithHelp label={turbo ? "Turbo LoRA" : `LoRA ${index + 1}`}>
                      {turbo
                        ? "工作流里的 MiniMax H3 Turbo LoRA。可开关、换文件、调强度。关掉等于强度为 0，不会从节点图里删掉。默认 1.0；节点允许更高，Studio 按作者常用区间收到 1.2。"
                        : "工作流里检测到的 LoRA。可开关、换文件、调强度。关掉等于强度为 0，不会从节点图里删掉。"}
                    </LabelWithHelp>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={lora.enabled}
                        disabled={readOnly}
                        onCheckedChange={(enabled) => {
                          onLorasChange((list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, enabled } : item
                            )
                          )
                        }}
                      />
                      <span className="text-sm">启用</span>
                    </div>
                    {loraFiles.length > 0 ? (
                      <Select
                        value={lora.name || undefined}
                        onValueChange={(name) => {
                          onLorasChange((list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, name } : item
                            )
                          )
                        }}
                        disabled={readOnly || !lora.enabled}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="选择 LoRA 文件" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {loraFiles.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={lora.name}
                        disabled={readOnly || !lora.enabled}
                        onChange={(event) => {
                          const name = event.target.value
                          onLorasChange((list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, name } : item
                            )
                          )
                        }}
                      />
                    )}
                    <Slider
                      min={0}
                      max={max}
                      step={0.05}
                      value={[strength]}
                      disabled={readOnly || !lora.enabled}
                      onValueChange={(value) => {
                        const next = Math.min(max, Math.max(0, value[0] ?? 1))
                        onLorasChange((list) =>
                          list.map((item, i) =>
                            i === index ? { ...item, strength: next, kind } : item
                          )
                        )
                      }}
                    />
                    <FieldDescription className="font-mono tabular-nums">
                      强度 {strength.toFixed(2)}
                    </FieldDescription>
                    <FieldDescription>
                      {turbo
                        ? "日常 1.00。发虚/拖影可加到约 1.20，过锐降到 0.80–0.95。"
                        : "常见 0.6–1.0，很少需要超过 1。"}
                    </FieldDescription>
                  </Field>
                )
              })}
            </FieldGroup>
          ) : null}
        </FieldGroup>
      )}
    </div>
  )
}

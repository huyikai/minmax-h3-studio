import type {
  LoraFormValue,
  MappingOverrides,
  WorkflowMapping,
} from "@/lib/types"

export type WorkflowBundle = {
  name: string
  mapping: WorkflowMapping
  detected: WorkflowMapping
  overrides: MappingOverrides
  values: {
    prompt: string
    duration: number
    width: number
    height: number
    aspect: string
    seed: number
    steps?: number
    cfg?: number
    loras: LoraFormValue[]
  }
  nodes: Array<{
    id: string
    classType: string
    title: string
    inputs: string[]
  }>
}

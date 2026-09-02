import type { LoraFormValue, LoraKind } from "@/lib/types"

export const TURBO_LORA_STRENGTH_MAX = 1.2
export const GENERIC_LORA_STRENGTH_MAX = 2

export function loraKind(lora: Pick<LoraFormValue, "kind" | "nested" | "strengthInput">): LoraKind {
  if (lora.kind === "turbo" || lora.kind === "generic") return lora.kind
  if (!lora.nested && lora.strengthInput === "strength") return "turbo"
  return "generic"
}

export function loraStrengthMax(kind: LoraKind) {
  return kind === "turbo" ? TURBO_LORA_STRENGTH_MAX : GENERIC_LORA_STRENGTH_MAX
}

export function clampLoraStrength(lora: LoraFormValue): number {
  const max = loraStrengthMax(loraKind(lora))
  const value = lora.strength
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(value, 0), max)
}

export function normalizeLora(lora: LoraFormValue): LoraFormValue {
  const kind = loraKind(lora)
  return {
    ...lora,
    kind,
    strength: clampLoraStrength({ ...lora, kind }),
  }
}

export function appliedLoraStrength(lora: LoraFormValue): number {
  if (!lora.enabled) return 0
  return clampLoraStrength(lora)
}

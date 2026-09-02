export const WORKSPACE_SPLIT_STORAGE_KEY = "studio.workspace-split:v1"
export const WORKSPACE_LEFT_MIN_REM = 22
export const WORKSPACE_LEFT_DEFAULT_REM = 28
export const WORKSPACE_RIGHT_MIN_REM = 28
export const WORKSPACE_SPLIT_MQ = "(min-width: 64rem)"

type StoredSplit = {
  leftPx: number
}

let memory: number | null | undefined

export function rootRemPx(): number {
  if (typeof document === "undefined") return 16
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(size) && size > 0 ? size : 16
}

export function defaultWorkspaceLeftPx(remPx = rootRemPx()): number {
  return WORKSPACE_LEFT_DEFAULT_REM * remPx
}

export function clampWorkspaceLeft(
  desiredPx: number,
  containerPx: number,
  remPx = rootRemPx(),
): number {
  const leftMin = WORKSPACE_LEFT_MIN_REM * remPx
  const fallback = defaultWorkspaceLeftPx(remPx)
  if (!Number.isFinite(desiredPx) || desiredPx <= 0) {
    desiredPx = fallback
  }
  if (!Number.isFinite(containerPx) || containerPx <= 0) {
    return Math.max(desiredPx, leftMin)
  }
  const rightMin = WORKSPACE_RIGHT_MIN_REM * remPx
  const maxLeft = Math.max(leftMin, containerPx - rightMin)
  return Math.min(Math.max(desiredPx, leftMin), maxLeft)
}

function parseStored(raw: string | null): number | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const leftPx = (parsed as StoredSplit).leftPx
    if (typeof leftPx !== "number" || !Number.isFinite(leftPx) || leftPx <= 0) {
      return null
    }
    return leftPx
  } catch {
    return null
  }
}

export function readWorkspaceLeftPx(): number | null {
  if (memory !== undefined) return memory
  try {
    memory = parseStored(localStorage.getItem(WORKSPACE_SPLIT_STORAGE_KEY))
    return memory
  } catch {
    memory = null
    return null
  }
}

export function writeWorkspaceLeftPx(px: number): void {
  const leftPx = Math.round(px)
  memory = leftPx
  try {
    const payload: StoredSplit = { leftPx }
    localStorage.setItem(WORKSPACE_SPLIT_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // private mode / quota
  }
}

export function ingestWorkspaceLeftStorage(raw: string | null): number | null {
  memory = parseStored(raw)
  return memory
}

export function isLargeWorkspaceSplit(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia(WORKSPACE_SPLIT_MQ).matches
}

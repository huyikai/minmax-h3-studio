"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
  WORKSPACE_LEFT_MIN_REM,
  WORKSPACE_RIGHT_MIN_REM,
  WORKSPACE_SPLIT_MQ,
  WORKSPACE_SPLIT_STORAGE_KEY,
  clampWorkspaceLeft,
  defaultWorkspaceLeftPx,
  ingestWorkspaceLeftStorage,
  isLargeWorkspaceSplit,
  readWorkspaceLeftPx,
  rootRemPx,
  writeWorkspaceLeftPx,
} from "@/lib/workspace-split"

type WorkspaceSplitProps = {
  left: ReactNode
  right: ReactNode
}

type DragState = {
  pointerId: number
  startX: number
  startWidth: number
}

function currentLeftPx(container: HTMLElement, remPx: number): number {
  const raw = getComputedStyle(container).getPropertyValue("--workspace-left").trim()
  if (raw.endsWith("px")) {
    const px = Number.parseFloat(raw)
    if (Number.isFinite(px) && px > 0) return px
  }
  return defaultWorkspaceLeftPx(remPx)
}

export function WorkspaceSplit({ left, right }: WorkspaceSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const desiredRef = useRef<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState(false)

  const applyDisplay = useCallback((desired: number) => {
    const container = containerRef.current
    if (!container) return 0
    const remPx = rootRemPx()
    const width = container.getBoundingClientRect().width
    const next = clampWorkspaceLeft(desired, width, remPx)
    container.style.setProperty("--workspace-left", `${next}px`)
    const handle = handleRef.current
    if (handle) {
      const leftMin = Math.round(WORKSPACE_LEFT_MIN_REM * remPx)
      const rightMin = Math.round(WORKSPACE_RIGHT_MIN_REM * remPx)
      handle.setAttribute("aria-valuenow", String(Math.round(next)))
      handle.setAttribute("aria-valuemin", String(leftMin))
      handle.setAttribute(
        "aria-valuemax",
        String(Math.round(Math.max(leftMin, width - rightMin))),
      )
    }
    return next
  }, [])

  const commitDesired = useCallback(
    (desired: number, persist: boolean) => {
      const next = applyDisplay(desired)
      desiredRef.current = next
      if (persist) writeWorkspaceLeftPx(next)
      return next
    },
    [applyDisplay],
  )

  useEffect(() => {
    const remPx = rootRemPx()
    const stored = readWorkspaceLeftPx()
    desiredRef.current = stored ?? defaultWorkspaceLeftPx(remPx)
    applyDisplay(desiredRef.current)

    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      if (dragRef.current) return
      const next = desiredRef.current
      if (next == null) return
      applyDisplay(next)
    })
    observer.observe(container)

    const media = window.matchMedia(WORKSPACE_SPLIT_MQ)
    const onMedia = () => {
      const next = desiredRef.current
      if (next == null) return
      applyDisplay(next)
    }
    media.addEventListener("change", onMedia)

    const onStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_SPLIT_STORAGE_KEY) return
      const next = ingestWorkspaceLeftStorage(event.newValue) ?? defaultWorkspaceLeftPx()
      desiredRef.current = next
      applyDisplay(next)
    }
    window.addEventListener("storage", onStorage)

    return () => {
      observer.disconnect()
      media.removeEventListener("change", onMedia)
      window.removeEventListener("storage", onStorage)
    }
  }, [applyDisplay])

  const endDrag = useCallback(
    (target: HTMLDivElement, pointerId: number) => {
      if (!dragRef.current) return
      dragRef.current = null
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId)
      }
      document.documentElement.style.removeProperty("cursor")
      document.documentElement.classList.remove("select-none")
      const desired = desiredRef.current
      if (desired != null) writeWorkspaceLeftPx(desired)
      setDragging(false)
    },
    [],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (!isLargeWorkspaceSplit()) return
    const container = containerRef.current
    if (!container) return
    event.preventDefault()
    const remPx = rootRemPx()
    const startWidth = currentLeftPx(container, remPx)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
    }
    desiredRef.current = startWidth
    event.currentTarget.setPointerCapture(event.pointerId)
    document.documentElement.style.cursor = "col-resize"
    document.documentElement.classList.add("select-none")
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = applyDisplay(drag.startWidth + (event.clientX - drag.startX))
    desiredRef.current = next
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    endDrag(event.currentTarget, event.pointerId)
  }

  const onDoubleClick = () => {
    if (!isLargeWorkspaceSplit()) return
    commitDesired(defaultWorkspaceLeftPx(), true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isLargeWorkspaceSplit()) return
    const container = containerRef.current
    if (!container) return
    const remPx = rootRemPx()
    const current = desiredRef.current ?? currentLeftPx(container, remPx)
    const step = (event.shiftKey ? 2 : 1) * remPx
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      commitDesired(current - step, true)
      return
    }
    if (event.key === "ArrowRight") {
      event.preventDefault()
      commitDesired(current + step, true)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      commitDesired(defaultWorkspaceLeftPx(remPx), true)
    }
  }

  return (
    <div
      ref={containerRef}
      id="studio-main"
      className="relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden [--workspace-left:28rem] lg:[grid-template-columns:var(--workspace-left)_minmax(0,1fr)]"
    >
      <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        {left}
        <div
          ref={handleRef}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整任务详情栏宽度"
          aria-valuemin={0}
          aria-valuemax={0}
          aria-valuenow={0}
          title="拖动调整宽度，双击还原"
          tabIndex={0}
          data-dragging={dragging ? "" : undefined}
          className={cn(
            "group absolute inset-y-0 right-0 z-10 hidden w-3 cursor-col-resize touch-none lg:block",
            "focus-visible:outline-none",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 right-0 w-px bg-border transition-colors",
              "group-hover:bg-primary group-focus-visible:bg-primary group-data-[dragging]:bg-primary",
            )}
          />
        </div>
      </div>
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">{right}</div>
    </div>
  )
}

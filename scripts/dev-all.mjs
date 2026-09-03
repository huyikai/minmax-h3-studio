#!/usr/bin/env node
import { spawn } from "node:child_process"

const processes = [
  spawn("pnpm", ["mock:comfy"], { stdio: "inherit" }),
  spawn("pnpm", ["dev"], { stdio: "inherit" }),
]
let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of processes) {
    if (!child.killed) child.kill(signal)
  }
}

for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return
    if (signal) shutdown(signal)
    else if (code !== 0) shutdown("SIGTERM")
  })
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { jobOutputDir } from "@/lib/paths"
import { MOTION_CONTEXT_AUDIO_HZ, stitchedFileName } from "@/lib/long-video"

function concatLine(filePath: string) {
  return `file '${filePath.replaceAll("'", "'\\''")}'`
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("本机没有 ffmpeg，无法拼接片段。请安装 ffmpeg 后再试。"))
        return
      }
      reject(error)
    })
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `ffmpeg 退出 ${code}`))
    })
  })
}

export async function stitchSegmentFiles(jobId: string, files: string[]) {
  const existing: string[] = []
  for (const file of files) {
    try {
      await fs.access(file)
      existing.push(file)
    } catch {
      // skip missing (voided leftovers are kept on purpose, but stitch only successes)
    }
  }
  if (existing.length === 0) {
    throw new Error("还没有可拼接的片段")
  }

  const dir = jobOutputDir(jobId)
  await fs.mkdir(dir, { recursive: true })
  const listPath = path.join(dir, "concat.txt")
  const outputPath = path.join(dir, stitchedFileName())
  await fs.writeFile(listPath, `${existing.map(concatLine).join("\n")}\n`)

  try {
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-ar",
      String(MOTION_CONTEXT_AUDIO_HZ),
      "-ac",
      "2",
      outputPath,
    ])
  } catch (error) {
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      String(MOTION_CONTEXT_AUDIO_HZ),
      "-ac",
      "2",
      outputPath,
    ]).catch(() => {
      throw error
    })
  }

  return outputPath
}

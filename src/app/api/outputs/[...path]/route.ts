import fs from "node:fs/promises"
import path from "node:path"
import { outputsDir } from "@/lib/paths"

export const dynamic = "force-dynamic"

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/outputs/[...path]">
) {
  const { path: segments } = await context.params
  const relative = segments.join("/")
  const fullPath = path.resolve(outputsDir(), relative)
  const root = path.resolve(outputsDir())
  if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
    return new Response("Forbidden", { status: 403 })
  }
  try {
    const data = await fs.readFile(fullPath)
    const ext = path.extname(fullPath).toLowerCase()
    return new Response(data, {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "private, no-cache",
      },
    })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}

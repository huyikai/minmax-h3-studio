import { listLoras } from "@/lib/comfy"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const loras = await listLoras()
    return Response.json({ loras })
  } catch (error) {
    return Response.json({
      loras: [],
      error: error instanceof Error ? error.message : "无法列出 LoRA",
    })
  }
}

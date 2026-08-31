import { getHealth } from "@/lib/comfy"

export const dynamic = "force-dynamic"

export async function GET() {
  const health = await getHealth()
  return Response.json(health)
}

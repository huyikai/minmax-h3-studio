import { evaluateEnvironment, type EnvironmentLine } from "@/lib/environment"

export const dynamic = "force-dynamic"

function parseLine(value: string | null): EnvironmentLine {
  if (value === "long" || value === "turbo" || value === "reference") return value
  return "short"
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const line = parseLine(url.searchParams.get("line"))
  const status = await evaluateEnvironment(line)
  return Response.json(status)
}

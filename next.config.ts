import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws"],
  // Keep the Next.js badge off the left generate bar.
  devIndicators: {
    position: "bottom-right",
  },
}

export default nextConfig

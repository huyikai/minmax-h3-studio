import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Providers } from "@/components/providers"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "MiniMax H3 Studio",
  description: "本地视频创作工具，通过 ComfyUI 调用本机 MiniMax H3 工作流。",
  icons: {
    icon: "/favicon.svg",
  },
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="relative z-0 flex min-h-[100dvh] flex-col font-sans">
        <a href="#studio-main" className="skip-link">
          跳到出片区
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

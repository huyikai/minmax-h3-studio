"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const OPTIONS = [
  { value: "system", label: "系统", Icon: MonitorIcon },
  { value: "light", label: "浅色", Icon: SunIcon },
  { value: "dark", label: "深色", Icon: MoonIcon },
] as const

function PreferenceIcon({ theme }: { theme: string | undefined }) {
  if (theme === "light") return <SunIcon />
  if (theme === "dark") return <MoonIcon />
  return <MonitorIcon />
}

const emptySubscribe = () => () => {}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

  const preference = mounted ? (theme ?? "system") : "system"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="outline" aria-label="主题">
          <PreferenceIcon theme={preference} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36!">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => setTheme(value)}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

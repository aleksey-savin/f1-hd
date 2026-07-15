"use client"

import { useContext } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { ThemeContext } from "@/store/theme-context"

// Тему берём из ThemeContext приложения (шаблон shadcn использует next-themes).
// Поверхность/границы — токены новой системы; z-index у sonner собственный,
// выше bootstrap-модалок.
const Toaster = ({ ...props }: ToasterProps) => {
  const { isDark } = useContext(ThemeContext)

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      position="bottom-right"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

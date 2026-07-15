import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Радиус 8px; фон — сток-семантика shadcn (прозрачный, в тёмной чуть
        // светлее панели)
        "tw:h-10 tw:w-full tw:min-w-0 tw:appearance-none tw:rounded-lg tw:border tw:border-input tw:bg-transparent tw:dark:bg-input/30 tw:px-3 tw:py-1 tw:text-base tw:text-foreground tw:transition-[color,box-shadow] tw:outline-none tw:selection:bg-primary tw:selection:text-primary-foreground tw:file:inline-flex tw:file:h-8 tw:file:border-0 tw:file:bg-transparent tw:file:text-sm tw:file:font-medium tw:file:text-foreground tw:placeholder:text-faint tw:disabled:pointer-events-none tw:disabled:cursor-not-allowed tw:disabled:opacity-50",
        "tw:focus-visible:border-ring tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
        "tw:aria-invalid:border-destructive tw:aria-invalid:ring-destructive/20 tw:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }

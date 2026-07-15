import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Радиус 8px, шрифт 14/600. Пока жив bootstrap (preflight выключен):
  // appearance/border/bg гасят браузерные дефолты кнопки, no-underline —
  // подчёркивание reboot у <a> (Button asChild + Link).
  "tw:inline-flex tw:shrink-0 tw:appearance-none tw:items-center tw:justify-center tw:gap-2 tw:rounded-lg tw:border tw:border-transparent tw:bg-transparent tw:text-sm tw:font-semibold tw:whitespace-nowrap tw:no-underline tw:transition-all tw:outline-none tw:hover:no-underline tw:focus-visible:border-ring tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:disabled:pointer-events-none tw:disabled:opacity-50 tw:aria-invalid:border-destructive tw:aria-invalid:ring-destructive/20 tw:dark:aria-invalid:ring-destructive/40 tw:[&_svg]:pointer-events-none tw:[&_svg]:shrink-0 tw:[&_svg:not([class*=size-])]:size-5",
  {
    variants: {
      variant: {
        default: "tw:bg-primary tw:text-primary-foreground tw:hover:bg-primary/90",
        destructive:
          "tw:bg-destructive tw:text-white tw:hover:bg-destructive/90 tw:focus-visible:ring-destructive/20 tw:dark:bg-destructive/60 tw:dark:focus-visible:ring-destructive/40",
        outline:
          "tw:border tw:border-input tw:bg-transparent tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground",
        secondary:
          "tw:bg-secondary tw:text-secondary-foreground tw:hover:bg-secondary/80",
        ghost:
          "tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground",
        link: "tw:text-primary tw:underline-offset-4 tw:hover:underline",
        // Семантика bootstrap-палитры (success/warning/info) — см. docs/ux-ui-guide.md
        success:
          "tw:bg-success tw:text-success-foreground tw:hover:bg-success/90 tw:focus-visible:ring-success/20",
        warning:
          "tw:bg-warning tw:text-warning-foreground tw:hover:bg-warning/90 tw:focus-visible:ring-warning/20",
        info: "tw:bg-info tw:text-info-foreground tw:hover:bg-info/90 tw:focus-visible:ring-info/20",
      },
      size: {
        default: "tw:h-10 tw:px-4 tw:has-[>svg]:px-3.5",
        xs: "tw:h-8 tw:gap-1.5 tw:px-2.5 tw:text-xs tw:has-[>svg]:px-2 tw:[&_svg:not([class*=size-])]:size-4",
        sm: "tw:h-9 tw:gap-1.5 tw:px-3 tw:has-[>svg]:px-2.5",
        lg: "tw:h-12 tw:px-6 tw:text-base tw:has-[>svg]:px-5",
        icon: "tw:size-10",
        "icon-xs": "tw:size-8 tw:[&_svg:not([class*=size-])]:size-4",
        "icon-sm": "tw:size-9",
        "icon-lg": "tw:size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

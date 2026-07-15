import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "tw:relative tw:grid tw:w-full tw:grid-cols-[0_1fr] tw:items-start tw:gap-y-0.5 tw:rounded-lg tw:border tw:px-4 tw:py-3 tw:text-sm tw:has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] tw:has-[>svg]:gap-x-3 tw:[&>svg]:size-4 tw:[&>svg]:translate-y-0.5 tw:[&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "tw:bg-card tw:text-card-foreground",
        destructive:
          "tw:bg-card tw:text-destructive tw:*:data-[slot=alert-description]:text-destructive/90 tw:[&>svg]:text-current",
        // Семантика bootstrap-палитры: подкрашенный фон в духе прежних алертов
        success:
          "tw:border-success/30 tw:bg-success/10 tw:text-success tw:*:data-[slot=alert-description]:text-success/90 tw:[&>svg]:text-current",
        warning:
          "tw:border-warning/30 tw:bg-warning/10 tw:text-warning tw:*:data-[slot=alert-description]:text-warning/90 tw:[&>svg]:text-current",
        info: "tw:border-info/30 tw:bg-info/10 tw:text-info tw:*:data-[slot=alert-description]:text-info/90 tw:[&>svg]:text-current",
        // Нейтральная плашка (бывший variant="light": пустые состояния, счётчики)
        light: "tw:border-transparent tw:bg-muted/60 tw:text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "tw:col-start-2 tw:line-clamp-1 tw:min-h-4 tw:font-medium tw:tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "tw:col-start-2 tw:grid tw:justify-items-start tw:gap-1 tw:text-sm tw:text-muted-foreground tw:[&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }

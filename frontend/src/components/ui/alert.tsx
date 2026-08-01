import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Точечный фикс генератора: shadcn пишет колонку под иконку как
// calc(var(--spacing)*4), но у нас Tailwind подключён с префиксом, и тема
// объявляет --tw-spacing — неизвестная переменная делает всё правило
// grid-template-columns невалидным, колонки становятся auto и делят свободное
// место поровну (текст алерта с иконкой уезжал на середину). Ставим литерал.
const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current",
        // Семантика bootstrap-палитры: подкрашенный фон в духе прежних алертов
        success:
          "border-success/30 bg-success/10 text-success *:data-[slot=alert-description]:text-success/90 [&>svg]:text-current",
        warning:
          "border-warning/30 bg-warning/10 text-warning *:data-[slot=alert-description]:text-warning/90 [&>svg]:text-current",
        info: "border-info/30 bg-info/10 text-info *:data-[slot=alert-description]:text-info/90 [&>svg]:text-current",
        // Нейтральная плашка (бывший variant="light": пустые состояния, счётчики)
        light: "border-transparent bg-muted/60 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

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
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };

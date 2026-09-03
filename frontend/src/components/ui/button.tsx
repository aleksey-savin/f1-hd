import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Радиус 8px, шрифт 14/600 — кегль контролов (см. «Типографика» в гайде).
  // appearance/border/bg гасят браузерные дефолты кнопки, no-underline —
  // подчёркивание у <a> (Button asChild + Link).
  "inline-flex shrink-0 appearance-none items-center justify-center gap-2 rounded-lg border border-transparent bg-transparent text-sm font-semibold whitespace-nowrap no-underline transition-all outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Семантика bootstrap-палитры (success/warning/info) — см. docs/ux-ui-guide.md
        success:
          "bg-success text-success-foreground hover:bg-success/90 focus-visible:ring-success/20",
        warning:
          "bg-warning text-warning-foreground hover:bg-warning/90 focus-visible:ring-warning/20",
        info: "bg-info text-info-foreground hover:bg-info/90 focus-visible:ring-info/20",
      },
      size: {
        // Высоты — как у полей: default = Input (40), sm — второстепенная
        // кнопка в ряду (36), xs — служебная (32, кегль 12), lg — hero (44, 16)
        default: "h-10 px-4 has-[>svg]:px-3.5",
        xs: "h-8 gap-1.5 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*=size-])]:size-4",
        sm: "h-9 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-6 text-base has-[>svg]:px-5",
        icon: "size-10",
        "icon-xs": "size-8 [&_svg:not([class*=size-])]:size-4",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Блок поля формы: лейбл (+ звёздочка обязательности) · контрол · подсказка.
// Единый вид полей во всех мигрированных формах — не собирать вручную.
const Field = ({
  label,
  htmlFor,
  required = false,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) => {
  return (
    <div className={cn("tw:mb-4", className)}>
      <Label
        htmlFor={htmlFor}
        className="tw:mb-1.5 tw:text-sm tw:font-semibold tw:text-muted-foreground"
      >
        {label}
        {required && <span className="tw:text-destructive">*</span>}
      </Label>
      {children}
      {hint && (
        <p className="tw:mt-1.5 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
};

export default Field;

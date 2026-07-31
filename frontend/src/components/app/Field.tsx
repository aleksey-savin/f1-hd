import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Блок поля формы: лейбл (+ звёздочка обязательности) · контрол · подсказка.
// Единый вид полей во всех мигрированных формах — не собирать вручную.
//
// `error` вытесняет `hint`: когда поле не в порядке, подсказка «как надо» уже
// не помогает, а два сообщения подряд читаются как одно. Сам контрол пометить
// `aria-invalid` — задача вызывающего: shadcn Input и Textarea по этому
// атрибуту красят рамку.
const Field = ({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
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
      {error ? (
        <p role="alert" className="tw:mt-1.5 tw:mb-0 tw:text-sm tw:text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p className="tw:mt-1.5 tw:mb-0 tw:text-sm tw:text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
};

export default Field;

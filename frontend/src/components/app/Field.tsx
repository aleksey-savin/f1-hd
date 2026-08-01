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
    <div className={cn("mb-4", className)}>
      <Label
        htmlFor={htmlFor}
        className="mb-1.5 text-sm font-semibold text-muted-foreground"
      >
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 mb-0 text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p className="mt-1.5 mb-0 text-sm text-muted-foreground">{hint}</p>
        )
      )}
    </div>
  );
};

export default Field;

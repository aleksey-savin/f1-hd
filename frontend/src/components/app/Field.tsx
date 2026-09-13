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
  aside,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** Действие в строке подписи, справа (кнопка «Сейчас» у полей времени) — не внутри Label, чтобы клик не уводил фокус в поле */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) => {
  const labelNode = (
    <Label
      htmlFor={htmlFor}
      className={cn(
        "text-sm font-semibold text-muted-foreground",
        !aside && "mb-1.5",
      )}
    >
      {label}
      {required && <span className="text-destructive">*</span>}
    </Label>
  );

  return (
    <div className={cn("mb-4", className)}>
      {aside ? (
        <div className="mb-1.5 flex items-center gap-2">
          {labelNode}
          <div className="ms-auto">{aside}</div>
        </div>
      ) : (
        labelNode
      )}
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

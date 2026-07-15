import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// tw-двойник UI/AlertMessage.jsx: тот же API (variant в терминах bootstrap),
// внутри — shadcn Alert с маппингом вариантов на токены.
// Валидные варианты shadcn Alert (см. components/ui/alert.tsx). `satisfies`
// проверяет, что каждое значение карты — реальный вариант, сохраняя при этом
// узкие литеральные ключи для BootstrapVariant.
type AlertVariant =
  | "default"
  | "destructive"
  | "success"
  | "warning"
  | "info"
  | "light";

const VARIANT_MAP = {
  danger: "destructive",
  success: "success",
  warning: "warning",
  info: "info",
  light: "light",
  primary: "default",
  secondary: "light",
  dark: "default",
} as const satisfies Record<string, AlertVariant>;

type BootstrapVariant = keyof typeof VARIANT_MAP;

const AlertMessage = ({
  variant = "light",
  message,
  className,
}: {
  variant?: BootstrapVariant;
  message: ReactNode;
  className?: string;
}) => {
  return (
    <Alert
      id="info-alert"
      variant={VARIANT_MAP[variant] ?? "light"}
      className={cn("tw:my-3", className)}
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
};

export default AlertMessage;

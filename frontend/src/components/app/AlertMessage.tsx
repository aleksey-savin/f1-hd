import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// tw-двойник UI/AlertMessage.jsx: тот же API (variant в терминах bootstrap),
// внутри — shadcn Alert с маппингом вариантов на токены.
const VARIANT_MAP = {
  danger: "destructive",
  success: "success",
  warning: "warning",
  info: "info",
  light: "light",
  primary: "default",
  secondary: "light",
  dark: "default",
} as const;

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

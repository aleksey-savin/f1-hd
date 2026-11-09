import type { ReviewAnalysis, ReviewStatus } from "@/types/userReview";
import { cn } from "@/lib/utils";

export const statusLabel: Record<ReviewStatus, string> = {
  pending: "Ждёт решения",
  disabled: "Отключён",
  deleted: "Удалён",
  dismissed: "Отклонено",
  deferred: "Отложено",
  restored: "Восстановлен",
};

const statusTone: Record<ReviewStatus, string> = {
  pending: "bg-warning/15 text-warning-text",
  disabled: "bg-warning/15 text-warning-text",
  deleted: "bg-destructive/10 text-destructive",
  dismissed: "bg-accent text-muted-foreground",
  deferred: "bg-info/15 text-info",
  restored: "bg-success/15 text-success",
};

export default function ReviewStatusBadge({
  status,
  className,
}: {
  status: ReviewStatus;
  className?: string;
}) {
  return (
    <StatusPill
      label={statusLabel[status]}
      tone={statusTone[status]}
      className={className}
    />
  );
}

const analysisLabel: Record<ReviewAnalysis["status"], string> = {
  pending: "Не проверена",
  processing: "Проверяется",
  done: "Проверена",
  error: "Ошибка анализа",
};

const analysisTone: Record<ReviewAnalysis["status"], string> = {
  pending: "bg-accent text-muted-foreground",
  processing: "bg-info/15 text-info",
  done: "bg-success/15 text-success",
  error: "bg-destructive/10 text-destructive",
};

export function AnalysisStatusBadge({
  status,
  className,
}: {
  status: ReviewAnalysis["status"];
  className?: string;
}) {
  return (
    <StatusPill
      label={analysisLabel[status]}
      tone={analysisTone[status]}
      className={className}
    />
  );
}

function StatusPill({
  label,
  tone,
  className,
}: {
  label: string;
  tone: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        tone,
        className,
      )}
    >
      {label}
    </span>
  );
}

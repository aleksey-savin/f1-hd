import { type ReactNode } from "react";
import { RiInboxLine } from "react-icons/ri";

// Пустое состояние отчёта — не пустота: объяснение + действие (канон гайда).
const EmptyReport = ({
  title,
  hint,
  action,
}: {
  title: ReactNode;
  hint: ReactNode;
  action?: ReactNode;
}) => (
  <div className="rounded-xl border border-border bg-card">
    <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
      <RiInboxLine size={44} aria-hidden className="mb-1 text-faint" />
      <div className="text-lg font-semibold">{title}</div>
      <p className="my-0 max-w-md text-base text-muted-foreground">{hint}</p>
      {action && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  </div>
);

export default EmptyReport;

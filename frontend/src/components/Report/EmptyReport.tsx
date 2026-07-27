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
  <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card">
    <div className="tw:flex tw:flex-col tw:items-center tw:gap-1.5 tw:px-6 tw:py-16 tw:text-center">
      <RiInboxLine size={44} aria-hidden className="tw:mb-1 tw:text-faint" />
      <div className="tw:text-lg tw:font-semibold">{title}</div>
      <p className="tw:my-0 tw:max-w-md tw:text-base tw:text-muted-foreground">
        {hint}
      </p>
      {action && (
        <div className="tw:mt-3 tw:flex tw:flex-wrap tw:justify-center tw:gap-2">
          {action}
        </div>
      )}
    </div>
  </div>
);

export default EmptyReport;

import { RiCheckLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import type { ReportRow } from "../../types/approval";
import { formatShortDate } from "../../util/format-date";

/**
 * Ход отчёта — тонкая полоса под шапкой карточки.
 *
 * Намеренно тихая: заметный элемент на карточке уже есть — маршрут подписей, и
 * вторая крупная лента конкурировала бы с ним. Полоса отвечает только на «где
 * документ и что дальше»: пройденные этапы несут дату и номер счёта, текущий
 * подсвечен, будущие молчат.
 *
 * Этапа «На утверждении» в полосе нет вовсе, если согласование с клиентом не
 * требуется: в жизни такого документа этого шага не было, и подпись
 * «не требуется» только занимала бы место.
 */

type StepState = "done" | "current" | "future";

const ALL_STEPS = [
  "preview",
  "pendingApproval",
  "approved",
  "awaitingPayment",
  "paid",
];

const ReportLifecycle = ({ report }: { report: ReportRow }) => {
  // Этап согласования не показываем вовсе, если оно не требуется: подпись
  // «не требуется» — это шум про то, чего в жизни документа не было
  const ORDER = report.approval?.required
    ? ALL_STEPS
    : ALL_STEPS.filter((step) => step !== "pendingApproval");

  const position = ORDER.indexOf(
    report.status === "declined" ? "pendingApproval" : report.status,
  );

  const stateOf = (key: string, index: number): StepState => {
    if (index < position) return "done";
    if (index === position) return "current";
    return "future";
  };

  const detailOf = (key: string): string | null => {
    if (key === "preview") {
      return report.approval?.submittedAt
        ? formatShortDate(report.approval.submittedAt)
        : formatShortDate(report.createdAt);
    }
    if (key === "pendingApproval") {
      if (report.status === "declined") return "вернулся на правку";
      if (report.approval?.autoApprovedAt) {
        return `по сроку · ${formatShortDate(report.approval.autoApprovedAt)}`;
      }
      if (report.awaiting?.kind === "subdivisions") {
        return `${report.awaiting.approved} из ${report.awaiting.total} частей`;
      }
      return report.awaiting?.name || null;
    }
    if (key === "approved" && report.invoice?.date) {
      return null;
    }
    if (key === "awaitingPayment" && report.invoice?.number) {
      return `${report.invoice.number}${
        report.invoice.date ? ` от ${formatShortDate(report.invoice.date)}` : ""
      }`;
    }
    if (key === "paid" && report.invoice?.fullyPaidAt) {
      return formatShortDate(report.invoice.fullyPaidAt);
    }
    return null;
  };

  const LABELS: Record<string, string> = {
    preview: "Превью",
    pendingApproval: "На утверждении",
    approved: "Ожидает счёта",
    awaitingPayment: "Ждём оплаты",
    paid: "Оплачен",
  };

  return (
    <div className="flex flex-wrap items-center text-sm">
      {ORDER.map((key, index) => {
        const state = stateOf(key, index);
        const detail = detailOf(key);
        return (
          <div key={key} className="contents">
            {index > 0 && (
              <span
                aria-hidden
                className="mx-2 h-px w-5 flex-none bg-border max-sm:mx-1 max-sm:w-2"
              />
            )}
            <span className="flex items-center gap-1.5 py-1">
              <span
                aria-hidden
                className={cn(
                  "grid size-4 flex-none place-items-center rounded-full text-xs",
                  state === "done" && "bg-primary text-primary-foreground",
                  state === "current" &&
                    "bg-transparent inset-ring-2 inset-ring-primary",
                  state === "future" &&
                    "bg-accent text-faint inset-ring inset-ring-border",
                )}
              >
                {state === "done" && <RiCheckLine size={10} />}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap",
                  state === "done" && "text-muted-foreground",
                  state === "current" && "font-semibold text-accent-text",
                  state === "future" && "text-faint",
                )}
              >
                {LABELS[key]}
                {detail && (
                  <span className="tabular-nums opacity-85"> · {detail}</span>
                )}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default ReportLifecycle;

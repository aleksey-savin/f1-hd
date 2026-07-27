import { useState } from "react";
import { RiTimeLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import type { PendingAbsence } from "@/types/teamSchedule";

import RejectDialog from "./RejectDialog";
import { fullName } from "./calendar";

type Props = {
  pending: PendingAbsence[];
  canManage: boolean;
  onDecide: (
    id: string,
    decision: "approve" | "reject",
    comment?: string,
  ) => Promise<void>;
  /** Сколько человек останется работать, если запрос подтвердить. */
  impactOf?: (id: string) => number | null;
  total?: number;
};

const humanDate = (key: string) => key.split("-").reverse().join(".");

const range = (from: string, to: string) =>
  from === to ? humanDate(from) : `${humanDate(from)} — ${humanDate(to)}`;

/**
 * Чужой запрос, ждущий решения, — инлайн-алерт с автором и датой, а не пункт
 * «⋯»-меню: решение, спрятанное в меню, принимается вслепую.
 */
const PendingAlert = ({ pending, canManage, onDecide, impactOf, total }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingAbsence | null>(null);

  if (!pending.length) {
    return null;
  }

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await onDecide(id, "approve");
    } finally {
      setBusyId(null);
    }
  };

  const names = pending
    .slice(0, 3)
    .map((item) => fullName(item.user))
    .join(" · ");

  if (!expanded) {
    return (
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3.5 tw:gap-y-2.5 tw:rounded-xl tw:border tw:border-warning/45 tw:bg-warning/10 tw:px-4 tw:py-3 tw:text-sm">
        <RiTimeLine className="tw:flex-none tw:text-warning" size={17} />
        <span className="tw:min-w-0 tw:flex-1">
          <b className="tw:font-semibold">
            {pending.length}{" "}
            {pending.length === 1 ? "запрос ждёт" : "запросов ждут"} решения
          </b>
          <span className="tw:text-muted-foreground"> · {names}</span>
        </span>
        <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
          Показать
        </Button>
      </div>
    );
  }

  return (
    <div className="tw:space-y-2.5">
      {pending.map((item) => (
        <div
          key={item._id}
          className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3.5 tw:gap-y-2.5 tw:rounded-xl tw:border tw:border-warning/45 tw:bg-warning/10 tw:px-4 tw:py-3 tw:text-sm"
        >
          <RiTimeLine className="tw:flex-none tw:text-warning" size={17} />
          <span className="tw:min-w-0 tw:flex-1">
            <b className="tw:font-semibold">
              {fullName(item.user)} — {item.typeLabel.toLowerCase()}
            </b>
            <span className="tw:block tw:text-xs tw:text-muted-foreground">
              {range(item.from, item.to)}
              {item.comment ? ` · «${item.comment}»` : ""}
            </span>
            {(() => {
              const left = impactOf?.(item._id);
              if (left === null || left === undefined || !total) return null;
              return (
                <span className="tw:block tw:text-xs tw:font-semibold tw:text-warning">
                  Если подтвердить — останется работать {left} из {total}
                </span>
              );
            })()}
          </span>
          {canManage ? (
            <>
              <Button
                size="sm"
                disabled={busyId === item._id}
                onClick={() => approve(item._id)}
              >
                Подтвердить
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busyId === item._id}
                onClick={() => setRejecting(item)}
              >
                Отклонить
              </Button>
            </>
          ) : (
            <span className="tw:text-xs tw:text-muted-foreground">на согласовании</span>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="tw:appearance-none tw:border-0 tw:bg-transparent tw:px-1 tw:text-xs tw:text-muted-foreground tw:underline"
      >
        Свернуть
      </button>

      {/* Диалог рендерится вне списка: строка исчезнет сразу после решения */}
      <RejectDialog
        request={rejecting}
        open={Boolean(rejecting)}
        onOpenChange={(next: boolean) => !next && setRejecting(null)}
        onConfirm={async (comment: string) => {
          if (rejecting) {
            await onDecide(rejecting._id, "reject", comment);
          }
        }}
      />
    </div>
  );
};

export default PendingAlert;

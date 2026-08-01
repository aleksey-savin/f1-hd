import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PersonalWork } from "../../types/employeesReport";

import { formatDayMonthTime } from "../../util/format-date";
import {
  WORK_CLASSES,
  WORK_CLASS_LABEL,
  financeStatusMeta,
  formatMinutes,
} from "./work-format";

// Мобильный вид списка работ: дата и длительность крупно, заявка и статус —
// метой. Таблица со скроллом в кармане не читается.
const PAGE = 10;

const PersonalWorksCards = ({ works }: { works: PersonalWork[] }) => {
  const [shown, setShown] = useState(PAGE);

  return (
    <div className="px-3.5">
      {works.slice(0, shown).map((work) => {
        const status = financeStatusMeta(work.financesStatus);
        const muted = status.key === "preview" || status.key === "none";
        const classColor =
          WORK_CLASSES.find((item) => item.key === work.workClass)?.color ??
          "var(--faint)";
        return (
          <div
            key={work._id}
            className="flex flex-col gap-1 border-t border-border-soft py-3 first:border-t-0"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-faint tabular-nums">
                {formatDayMonthTime(work.startedAt)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 flex-none rounded-xs"
                  style={{ background: classColor }}
                />
                {WORK_CLASS_LABEL[work.workClass]}
              </span>
              <span className="ms-auto font-semibold tabular-nums">
                {formatMinutes(work.durationMinutes)}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              {work.tickets.map((ticket) => (
                <Link
                  key={ticket._id}
                  to={`/tickets/${ticket.num}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-accent-text no-underline tabular-nums"
                >
                  №{ticket.num}
                </Link>
              ))}
              <span className="line-clamp-2 text-muted-foreground">
                {work.description || "без описания"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-xs">
              <span className="text-faint">{work.company?.alias ?? "—"}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5",
                  muted ? "text-muted-foreground" : "text-accent-text",
                )}
              >
                <span
                  aria-hidden
                  className="size-1.5 flex-none rounded-full"
                  style={{ background: status.color, opacity: muted ? 0.5 : 1 }}
                />
                {status.label}
              </span>
              {work.overtime.roundedMinutes > 0 && (
                <span className="text-warning tabular-nums">
                  переработка {formatMinutes(work.overtime.roundedMinutes)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {shown < works.length && (
        <div className="border-t border-border-soft py-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-accent-text"
            onClick={() => setShown((current) => current + PAGE)}
          >
            Показать ещё {Math.min(PAGE, works.length - shown)}
          </Button>
        </div>
      )}
    </div>
  );
};

export default PersonalWorksCards;

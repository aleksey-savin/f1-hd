import { RiCheckLine, RiCloseLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Eyebrow, Panel } from "@/components/app/Panel";
import { cn } from "@/lib/utils";
import { displayTimeZone } from "@/util/format-date";
import { isOpenChange } from "@/util/inventory-changes";
import { decisionNote } from "@/util/mikrotik-changes";

// Точка шага — как у шагов запроса Mikrotik (components/Mikrotik/ChangeSteps)
const DOT = {
  done: "border-primary bg-primary text-primary-foreground",
  rejected: "border-destructive bg-destructive text-primary-foreground",
  current: "border-warning text-warning",
  pending: "border-border text-faint",
};

const APPROVE_HINT =
  "Вы видите кнопки, потому что запрос подан от вашего имени. Операции применяются по порядку; если одна не пройдёт, следующие не выполнятся.";

const stateOf = (change) => {
  if (change.decision?.decision === "approve") return "done";
  if (change.decision?.decision === "reject") return "rejected";
  return change.status === "awaiting_requester" ? "current" : "pending";
};

/**
 * Панель «Утверждение»: один шаг — автор запроса утверждает весь пакет. Кнопки
 * решения — только автору, пока предложение открыто и срок не вышел
 * (`my.canDecide`); сотрудник, который видит чужое открытое предложение,
 * получает подпись «Решает только автор запроса.». Диалоги — у страницы.
 */
const ChangeDecision = ({ change, onApprove, onReject }) => {
  const timeZone = displayTimeZone();
  const state = stateOf(change);
  const decision = change.decision;
  const canDecide = Boolean(change.my?.canDecide);
  const live = isOpenChange(change);
  const name = change.requestedBy?.name;

  const note =
    state === "done" || state === "rejected"
      ? decisionNote(
          {
            role: "requester",
            decision: decision.decision,
            channel: decision.channel,
            decidedAt: decision.at,
          },
          1,
          { timeZone },
        )
      : state === "current"
        ? "Утверждает весь пакет целиком"
        : "Решения не было";

  return (
    <>
      <Eyebrow>Утверждение</Eyebrow>
      <Panel>
        <div className="flex flex-col gap-3">
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-5 place-items-center rounded-full border-2 text-xs font-bold",
                  DOT[state],
                )}
              >
                {state === "done" ? (
                  <RiCheckLine size={13} />
                ) : state === "rejected" ? (
                  <RiCloseLine size={13} />
                ) : (
                  1
                )}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm wrap-anywhere">
                  {name ? `${name}, автор запроса` : "Автор запроса"}
                </span>
                <span className="text-xs text-faint">{note}</span>
                {state === "rejected" && decision.comment && (
                  <span className="text-xs wrap-anywhere text-muted-foreground">
                    «{decision.comment}»
                  </span>
                )}
              </div>
            </li>
          </ol>
          {canDecide ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button className="flex-1" onClick={onApprove}>
                  Утвердить
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={onReject}
                >
                  Отклонить
                </Button>
              </div>
              <span className="text-xs text-faint">{APPROVE_HINT}</span>
            </>
          ) : (
            live && (
              <span className="text-xs text-faint">
                Решает только автор запроса.
              </span>
            )
          )}
        </div>
      </Panel>
    </>
  );
};

export default ChangeDecision;

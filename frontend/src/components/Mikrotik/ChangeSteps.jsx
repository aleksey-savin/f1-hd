import { RiCheckLine, RiCloseLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Eyebrow, Panel } from "@/components/app/Panel";
import { cn } from "@/lib/utils";
import { displayTimeZone } from "@/util/format-date";
import {
  ROLE_LABEL,
  actionLabel,
  approveHint,
  decisionNote,
  pendingNote,
  stepState,
} from "@/util/mikrotik-changes";

const DOT = {
  done: "border-primary bg-primary text-primary-foreground",
  rejected: "border-destructive bg-destructive text-primary-foreground",
  current: "border-warning text-warning",
  pending: "border-border text-faint",
};

const CONFIRM_HINT =
  "Вы видите кнопки, потому что запрос подан от вашего имени.";

// Панель «Утверждение»: шаги (сделан · текущий · ждёт · отклонён) и, если
// очередь за этим человеком, кнопки решения. Диалоги подтверждения — у страницы.
const ChangeSteps = ({ change, onAct, onReject }) => {
  const steps = change.steps || [];
  const action = change.my?.action;
  const timeZone = displayTimeZone();

  return (
    <>
      <Eyebrow>Утверждение</Eyebrow>
      <Panel>
        <div className="flex flex-col gap-3">
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {steps.map((step, index) => {
              const state = stepState(steps, index, change.status);
              const decided = state === "done" || state === "rejected";
              return (
                <li
                  key={index}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2"
                >
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
                      index + 1
                    )}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm wrap-anywhere">
                      {step.user?.name || "Не назначен"}
                      {ROLE_LABEL[step.role] && `, ${ROLE_LABEL[step.role]}`}
                    </span>
                    <span className="text-xs text-faint">
                      {decided
                        ? decisionNote(step, steps.length, { timeZone })
                        : pendingNote(step, state, change.status, steps.length)}
                    </span>
                    {step.comment && (
                      <span className="text-xs wrap-anywhere text-muted-foreground">
                        «{step.comment}»
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {action && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button className="flex-1" onClick={() => onAct(action)}>
                  {actionLabel(action)}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={onReject}
                >
                  Отклонить
                </Button>
              </div>
              <span className="text-xs text-faint">
                {action === "confirm"
                  ? CONFIRM_HINT
                  : approveHint(change.rollback)}
              </span>
            </>
          )}
        </div>
      </Panel>
    </>
  );
};

export default ChangeSteps;

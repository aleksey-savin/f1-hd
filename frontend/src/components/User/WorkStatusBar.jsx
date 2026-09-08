import { useContext, useEffect, useState } from "react";

import { RiArrowLeftSLine } from "react-icons/ri";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../../store/authed-user-context";
import useWorkStatusesStore from "../../store/work-statuses";
import usePolling from "../../hooks/use-polling";
import {
  availabilitySummary,
  groupByStatus,
  presenceLine,
  updatedLabel,
} from "./presence";
import { GroupHeading, IdleGroup, PersonRow } from "./PresenceList";
import WorkStatusAvatar from "./WorkStatusAvatar";

// Рейл статусов сотрудников (десктоп, ≥ lg): вертикальная панель у правого
// края, свёрнута до колонки аватаров с тултипами влево, раскрывается в список
// со статусом текстом, сводкой в шапке и футером «Обновлено…».
//
// Раскрытый рейл СТОИТ В ПОТОКЕ, а не накрывает контент: сам он fixed (иначе
// уезжал бы со скроллом), а место под него резервирует оболочка —
// `has-ws-rail` / `has-ws-rail-open` в layout/Root по состоянию стора.
//
// Норма молчит: «не на работе» и «не указан» (kind idle) свёрнуты в строку со
// счётчиком, в свёрнутом рейле — в кружок «+N»; кольца и имена — у тех, кто на
// связи, и у исключений (отпуск, больничный). Сводка в шапке — от доступности.
// Авторизованный пользователь в списки не попадает — его статус в навбаре.
// Мобильной ленты больше нет: на телефоне команда — блок на главной.
const personTitle = (user) =>
  `${user.lastName} ${user.firstName} — ${presenceLine(user)}`;

const WorkStatusBar = () => {
  const authedUser = useContext(AuthedUserContext);
  const {
    users,
    isLoaded,
    silentRefresh,
    railOpen: open,
    toggleRail: toggle,
  } = useWorkStatusesStore();
  const [idleOpen, setIdleOpen] = useState({});

  const isStaff =
    !!authedUser._id && !authedUser.isEndUser && !authedUser.hideWorkStatus;

  useEffect(() => {
    if (isStaff) {
      silentRefresh();
    }
  }, [isStaff, silentRefresh]);

  usePolling(silentRefresh, { intervalMs: 15000, enabled: isStaff });

  if (!isStaff || !isLoaded) {
    return null;
  }

  const colleagues = users.filter(
    (user) => String(user._id) !== String(authedUser._id),
  );
  if (colleagues.length === 0) {
    return null;
  }

  const groups = groupByStatus(colleagues);
  const shown = groups.filter((group) => group.status.kind !== "idle");
  const idle = groups.filter((group) => group.status.kind === "idle");
  const idleCount = idle.reduce((sum, group) => sum + group.users.length, 0);
  const idleTitle = idle
    .map((group) => `${group.status.label} · ${group.users.length}`)
    .join(", ");

  const summary = availabilitySummary(colleagues);

  // Футер честен ко времени данных: max(updatedAt), не «сейчас»
  // (паттерн Telegram-табло)
  const lastUpdatedAt = colleagues.reduce((latest, user) => {
    const value = user.workStatus?.updatedAt;
    return value && (!latest || value > latest) ? value : latest;
  }, null);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 right-0 flex flex-col overflow-hidden border-l border-border bg-card pt-16 transition-[width] duration-300 max-lg:hidden",
        open ? "w-84" : "w-18",
      )}
      style={{ zIndex: 1020 }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        title={open ? "Свернуть" : "Статусы сотрудников"}
        className={cn(
          // 16px слева — как у заголовков групп и футера; min-h-12 в обоих
          // состояниях, иначе стрелка прыгала на 3px при сворачивании
          "flex min-h-12 w-full cursor-pointer appearance-none items-center gap-2.5 border-0 bg-transparent text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
          open
            ? "border-b border-border-soft px-4 py-2"
            : "justify-center px-1.5 py-2",
        )}
      >
        <span
          aria-hidden
          className="grid size-6.5 flex-none place-items-center rounded-md text-muted-foreground transition-transform duration-300 hover:bg-accent"
        >
          <RiArrowLeftSLine
            size={16}
            className={cn(
              "transition-transform duration-300",
              open && "rotate-180",
            )}
          />
        </span>
        {open && (
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-muted-foreground uppercase">
              <span
                className="ws-live relative inline-block size-2 flex-none rounded-full bg-primary"
                aria-hidden="true"
              />{" "}
              Сотрудники
            </span>
            <span className="block truncate text-xs text-muted-foreground tabular-nums">
              {summary}
            </span>
          </span>
        )}
      </button>

      {/* pt-2 — первому заголовку те же 8px под шапкой, что остальным под
          разделителем (mt-1.5 + pt-2 у групп ниже) */}
      <div className="ws-rail-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pb-2.5">
        <TooltipProvider delayDuration={150}>
          {shown.map((group, groupIndex) => (
            <div
              key={group.status.code}
              className={cn(
                groupIndex > 0 && "mt-1.5 border-t border-border-soft pt-2",
              )}
            >
              {open && (
                <GroupHeading
                  status={group.status}
                  count={group.users.length}
                  className="mb-1 px-4"
                />
              )}
              {open
                ? group.users.map((user) => (
                    <PersonRow
                      key={user._id}
                      user={user}
                      status={group.status}
                    />
                  ))
                : group.users.map((user) => (
                    <Tooltip key={user._id}>
                      <TooltipTrigger asChild>
                        <div className="flex justify-center px-1.5 py-1">
                          <WorkStatusAvatar
                            size={38}
                            firstName={user.firstName}
                            lastName={user.lastName}
                            profileImagePath={user.profileImagePath}
                            workStatus={user.workStatus}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        {personTitle(user)}
                      </TooltipContent>
                    </Tooltip>
                  ))}
            </div>
          ))}

          {idle.length > 0 &&
            (open ? (
              idle.map((group) => (
                <IdleGroup
                  key={group.status.code}
                  status={group.status}
                  users={group.users}
                  open={!!idleOpen[group.status.code]}
                  onToggle={() =>
                    setIdleOpen((prev) => ({
                      ...prev,
                      [group.status.code]: !prev[group.status.code],
                    }))
                  }
                  className={cn(
                    (shown.length > 0 || groups[0] !== group) &&
                      "mt-1.5 border-t border-border-soft pt-1",
                  )}
                />
              ))
            ) : (
              <div
                className={cn(
                  shown.length > 0 && "mt-1.5 border-t border-border-soft pt-2",
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="mx-auto grid h-6 w-9.5 cursor-default place-items-center rounded-full bg-accent text-xs font-semibold text-muted-foreground tabular-nums">
                      +{idleCount}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left">{idleTitle}</TooltipContent>
                </Tooltip>
              </div>
            ))}
        </TooltipProvider>
      </div>

      {open && lastUpdatedAt && (
        <div className="flex-none truncate border-t border-border-soft px-4 py-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {/* Про ночной сброс писать больше нельзя: днём статусы ведёт
              автоматика по графику (services/workStatusAuto) */}
          Обновлено {updatedLabel(lastUpdatedAt)} · статусы меняются по
          графику
        </div>
      )}
    </aside>
  );
};

export default WorkStatusBar;

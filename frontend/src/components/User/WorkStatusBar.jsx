import { useContext, useEffect, useState } from "react";

import { RiArrowDownSLine, RiArrowLeftSLine } from "react-icons/ri";

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
import { WORK_STATUSES } from "../../util/work-statuses";
import {
  businessDayKey,
  formatDayMonth,
  formatTime,
} from "../../util/format-date";
import WorkStatusAvatar from "./WorkStatusAvatar";

const STORAGE_KEY = "workStatusBarOpen";

// «с HH:MM» для сегодняшних смен статуса, «с DD.MM» для более старых. «Сегодня»
// — день бизнес-таймзоны (табло общее для всей организации), а не браузера.
const sinceLabel = (updatedAt) => {
  if (!updatedAt) {
    return "";
  }
  return businessDayKey(updatedAt) === businessDayKey()
    ? `с ${formatTime(updatedAt)}`
    : `с ${formatDayMonth(updatedAt)}`;
};

const personTitle = (user, status) =>
  `${user.lastName} ${user.firstName} — ${status.label}` +
  (user.workStatus?.note ? ` (${user.workStatus.note})` : "");

// Uppercase-заголовок группы цветом статуса, счётчик — приглушённый
const GroupHeading = ({ status, count, className }) => (
  <p
    className={cn(
      "my-0 flex items-baseline gap-1.5 text-xs font-bold tracking-wider whitespace-nowrap uppercase",
      className,
    )}
    style={{ color: status.color }}
  >
    {status.emoji} {status.label}
    <span className="font-semibold tracking-normal text-faint">· {count}</span>
  </p>
);

// Строка сотрудника в развёрнутом виде: имя, статус текстом, время, заметка
const PersonRow = ({ user, status }) => (
  <div className="flex min-h-12 items-center gap-2.5 px-3.5 py-1 transition-colors hover:bg-accent">
    <WorkStatusAvatar
      size={38}
      firstName={user.firstName}
      lastName={user.lastName}
      profileImagePath={user.profileImagePath}
      workStatus={user.workStatus}
    />
    <span className="min-w-0 flex-1 leading-snug">
      <span className="block truncate text-sm font-semibold">
        {user.lastName} {user.firstName}
      </span>
      <span className="block truncate text-xs" style={{ color: status.color }}>
        {status.label}
        {user.workStatus?.updatedAt && (
          <span className="text-muted-foreground tabular-nums">
            {" "}
            · {sinceLabel(user.workStatus.updatedAt)}
          </span>
        )}
      </span>
      {user.workStatus?.note && (
        <span className="block truncate text-xs text-muted-foreground">
          {user.workStatus.note}
        </span>
      )}
    </span>
  </div>
);

// Бар статусов сотрудников (согласованный мокап, перенос на tw — Фаза 2+):
// - rail: вертикальная панель у правого края (десктоп), свёрнута до колонки
//   кругляшей с тултипами влево, раскрывается в список со статусом текстом,
//   сводкой в шапке и футером «Обновлено…»;
// - strip: тонкая лента сверху (мобильный app-shell), горизонтальный скролл
//   со скрытым скролл-баром и градиентом справа, тап раскрывает список.
// Авторизованный пользователь в списки не попадает — его статус в навбаре.
const WorkStatusBar = ({ variant = "rail" }) => {
  const authedUser = useContext(AuthedUserContext);
  const { users, isLoaded, silentRefresh } = useWorkStatusesStore();
  const [open, setOpen] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

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

  const groups = WORK_STATUSES.map((status) => ({
    status,
    users: colleagues.filter(
      (user) => (user.workStatus?.code || "unset") === status.code,
    ),
  })).filter((group) => group.users.length > 0);

  const summary = groups
    .filter((group) => group.status.code !== "unset")
    .slice(0, 3)
    .map((group) => `${group.users.length} ${group.status.label}`)
    .join(" · ");

  // Футер честен ко времени данных: max(updatedAt), не «сейчас»
  // (паттерн Telegram-табло)
  const lastUpdatedAt = colleagues.reduce((latest, user) => {
    const value = user.workStatus?.updatedAt;
    return value && (!latest || value > latest) ? value : latest;
  }, null);

  const toggle = () => {
    setOpen((prev) => {
      localStorage.setItem(STORAGE_KEY, String(!prev));
      return !prev;
    });
  };

  if (variant === "strip") {
    return (
      <div className="flex-none border-b border-border bg-card">
        <button
          type="button"
          aria-expanded={open}
          aria-label="Статусы сотрудников"
          onClick={toggle}
          className="flex w-full cursor-pointer appearance-none items-center gap-2.5 border-0 bg-transparent px-3 py-1.5 outline-none focus-visible:ring-4 focus-visible:ring-ring/50"
        >
          <span
            className="ws-live relative inline-block size-2 flex-none rounded-full bg-primary"
            aria-hidden="true"
          />
          <span className="relative min-w-0 flex-1">
            <span className="ws-strip-scroll flex items-center gap-2.5 overflow-x-auto py-1 pe-6">
              {groups.map((group, groupIndex) => (
                <span
                  key={group.status.code}
                  className="flex flex-none items-center gap-1"
                >
                  {groupIndex > 0 && (
                    <span
                      aria-hidden
                      className="me-1.5 h-5 w-px flex-none bg-border"
                    />
                  )}
                  {group.users.map((user) => (
                    <WorkStatusAvatar
                      key={user._id}
                      size={32}
                      firstName={user.firstName}
                      lastName={user.lastName}
                      profileImagePath={user.profileImagePath}
                      workStatus={user.workStatus}
                    />
                  ))}
                </span>
              ))}
            </span>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-card"
            />
          </span>
          <RiArrowDownSLine
            size={17}
            aria-hidden
            className={cn(
              "flex-none text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-3">
            {groups.map((group) => (
              <div key={group.status.code}>
                <GroupHeading
                  status={group.status}
                  count={group.users.length}
                  className="mb-1.5"
                />
                {group.users.map((user) => (
                  <div
                    key={user._id}
                    className="mb-1.5 flex items-center gap-2 rounded-lg border border-border-soft bg-background px-2 py-1.5 last:mb-0"
                  >
                    <WorkStatusAvatar
                      size={26}
                      firstName={user.firstName}
                      lastName={user.lastName}
                      profileImagePath={user.profileImagePath}
                      workStatus={user.workStatus}
                      showBadge={false}
                    />
                    <span className="text-sm font-semibold whitespace-nowrap">
                      {user.lastName} {user.firstName}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {user.workStatus?.note}
                    </span>
                    {user.workStatus?.updatedAt && (
                      <span className="flex-none border-s border-border-soft ps-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {sinceLabel(user.workStatus.updatedAt)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 right-0 flex flex-col overflow-hidden border-l border-border bg-card pt-16 transition-[width] duration-300 max-lg:hidden",
        open ? "w-84 shadow-2xl" : "w-18",
      )}
      style={{ zIndex: 1020 }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        title={open ? "Свернуть" : "Статусы сотрудников"}
        className={cn(
          "flex w-full cursor-pointer appearance-none items-center gap-2.5 border-0 bg-transparent text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
          open
            ? "min-h-12 border-b border-border-soft px-3.5 py-2"
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
            {summary && (
              <span className="block truncate text-xs text-muted-foreground tabular-nums">
                {summary}
              </span>
            )}
          </span>
        )}
      </button>

      <div className="ws-rail-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1 pb-2.5">
        <TooltipProvider delayDuration={150}>
          {groups.map((group, groupIndex) => (
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
                        {personTitle(user, group.status)}
                      </TooltipContent>
                    </Tooltip>
                  ))}
            </div>
          ))}
        </TooltipProvider>
      </div>

      {open && lastUpdatedAt && (
        <div className="flex-none truncate border-t border-border-soft px-4 py-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {/* Про ночной сброс писать больше нельзя: днём статусы ведёт
              автоматика по графику (services/workStatusAuto) */}
          Обновлено {sinceLabel(lastUpdatedAt).replace(/^с /, "в ")} · статусы
          меняются по графику
        </div>
      )}
    </aside>
  );
};

export default WorkStatusBar;

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
import WorkStatusAvatar from "./WorkStatusAvatar";

const STORAGE_KEY = "workStatusBarOpen";

// «с HH:MM» для сегодняшних смен статуса, «с DD.MM» для более старых
const sinceLabel = (updatedAt) => {
  if (!updatedAt) {
    return "";
  }
  const date = new Date(updatedAt);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? `с ${date.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}`
    : `с ${date.toLocaleDateString("ru", { day: "2-digit", month: "2-digit" })}`;
};

const personTitle = (user, status) =>
  `${user.lastName} ${user.firstName} — ${status.label}` +
  (user.workStatus?.note ? ` (${user.workStatus.note})` : "");

// Uppercase-заголовок группы цветом статуса, счётчик — приглушённый
const GroupHeading = ({ status, count, className }) => (
  <p
    className={cn(
      "tw:my-0 tw:flex tw:items-baseline tw:gap-1.5 tw:text-xs tw:font-bold tw:tracking-wider tw:whitespace-nowrap tw:uppercase",
      className,
    )}
    style={{ color: status.color }}
  >
    {status.emoji} {status.label}
    <span className="tw:font-semibold tw:tracking-normal tw:text-faint">
      · {count}
    </span>
  </p>
);

// Строка сотрудника в развёрнутом виде: имя, статус текстом, время, заметка
const PersonRow = ({ user, status }) => (
  <div className="tw:flex tw:min-h-12 tw:items-center tw:gap-2.5 tw:px-3.5 tw:py-1 tw:transition-colors tw:hover:bg-accent">
    <WorkStatusAvatar
      size={38}
      firstName={user.firstName}
      lastName={user.lastName}
      profileImagePath={user.profileImagePath}
      workStatus={user.workStatus}
    />
    <span className="tw:min-w-0 tw:flex-1 tw:leading-snug">
      <span className="tw:block tw:truncate tw:text-sm tw:font-semibold">
        {user.lastName} {user.firstName}
      </span>
      <span
        className="tw:block tw:truncate tw:text-xs"
        style={{ color: status.color }}
      >
        {status.label}
        {user.workStatus?.updatedAt && (
          <span className="tw:text-muted-foreground tw:tabular-nums">
            {" "}
            · {sinceLabel(user.workStatus.updatedAt)}
          </span>
        )}
      </span>
      {user.workStatus?.note && (
        <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground">
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
  const longLivedEmojis = WORK_STATUSES.filter((status) => status.longLived)
    .map((status) => status.emoji)
    .join(" и ");

  const toggle = () => {
    setOpen((prev) => {
      localStorage.setItem(STORAGE_KEY, String(!prev));
      return !prev;
    });
  };

  if (variant === "strip") {
    return (
      <div className="tw:flex-none tw:border-b tw:border-border tw:bg-card">
        <button
          type="button"
          aria-expanded={open}
          aria-label="Статусы сотрудников"
          onClick={toggle}
          className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2.5 tw:border-0 tw:bg-transparent tw:px-3 tw:py-1.5 tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
        >
          <span className="ws-live" aria-hidden="true" />
          <span className="tw:relative tw:min-w-0 tw:flex-1">
            <span className="ws-strip-scroll tw:flex tw:items-center tw:gap-2.5 tw:overflow-x-auto tw:py-1 tw:pe-6">
              {groups.map((group, groupIndex) => (
                <span
                  key={group.status.code}
                  className="tw:flex tw:flex-none tw:items-center tw:gap-1"
                >
                  {groupIndex > 0 && (
                    <span
                      aria-hidden
                      className="tw:me-1.5 tw:h-5 tw:w-px tw:flex-none tw:bg-border"
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
              className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:right-0 tw:w-8 tw:bg-gradient-to-r tw:from-transparent tw:to-card"
            />
          </span>
          <RiArrowDownSLine
            size={17}
            aria-hidden
            className={cn(
              "tw:flex-none tw:text-muted-foreground tw:transition-transform",
              open && "tw:rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="tw:flex tw:max-h-72 tw:flex-col tw:gap-3 tw:overflow-y-auto tw:px-3 tw:pt-1 tw:pb-3">
            {groups.map((group) => (
              <div key={group.status.code}>
                <GroupHeading
                  status={group.status}
                  count={group.users.length}
                  className="tw:mb-1.5"
                />
                {group.users.map((user) => (
                  <div
                    key={user._id}
                    className="tw:mb-1.5 tw:flex tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-border-soft tw:bg-background tw:px-2 tw:py-1.5 tw:last:mb-0"
                  >
                    <WorkStatusAvatar
                      size={26}
                      firstName={user.firstName}
                      lastName={user.lastName}
                      profileImagePath={user.profileImagePath}
                      workStatus={user.workStatus}
                      showBadge={false}
                    />
                    <span className="tw:text-sm tw:font-semibold tw:whitespace-nowrap">
                      {user.lastName} {user.firstName}
                    </span>
                    <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-xs tw:text-muted-foreground">
                      {user.workStatus?.note}
                    </span>
                    {user.workStatus?.updatedAt && (
                      <span className="tw:flex-none tw:border-s tw:border-border-soft tw:ps-2 tw:text-xs tw:whitespace-nowrap tw:text-muted-foreground tw:tabular-nums">
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
        "tw:fixed tw:inset-y-0 tw:right-0 tw:flex tw:flex-col tw:overflow-hidden tw:border-l tw:border-border tw:bg-card tw:pt-16 tw:transition-[width] tw:duration-300 tw:max-lg:hidden",
        open ? "tw:w-84 tw:shadow-2xl" : "tw:w-18",
      )}
      style={{ zIndex: 1020 }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        title={open ? "Свернуть" : "Статусы сотрудников"}
        className={cn(
          "tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2.5 tw:border-0 tw:bg-transparent tw:text-left tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
          open
            ? "tw:min-h-12 tw:border-b tw:border-border-soft tw:px-3.5 tw:py-2"
            : "tw:justify-center tw:px-1.5 tw:py-2",
        )}
      >
        <span
          aria-hidden
          className="tw:grid tw:size-6.5 tw:flex-none tw:place-items-center tw:rounded-md tw:text-muted-foreground tw:transition-transform tw:duration-300 tw:hover:bg-accent"
        >
          <RiArrowLeftSLine
            size={16}
            className={cn("tw:transition-transform tw:duration-300", open && "tw:rotate-180")}
          />
        </span>
        {open && (
          <span className="tw:min-w-0 tw:flex-1">
            <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-bold tw:tracking-wider tw:text-muted-foreground tw:uppercase">
              <span className="ws-live" aria-hidden="true" /> Сотрудники
            </span>
            {summary && (
              <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground tw:tabular-nums">
                {summary}
              </span>
            )}
          </span>
        )}
      </button>

      <div className="ws-rail-scroll tw:min-h-0 tw:flex-1 tw:overflow-x-hidden tw:overflow-y-auto tw:pt-1 tw:pb-2.5">
        <TooltipProvider delayDuration={150}>
          {groups.map((group, groupIndex) => (
            <div
              key={group.status.code}
              className={cn(
                groupIndex > 0 &&
                  "tw:mt-1.5 tw:border-t tw:border-border-soft tw:pt-2",
              )}
            >
              {open && (
                <GroupHeading
                  status={group.status}
                  count={group.users.length}
                  className="tw:mb-1 tw:px-4"
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
                        <div className="tw:flex tw:justify-center tw:px-1.5 tw:py-1">
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
        <div className="tw:flex-none tw:truncate tw:border-t tw:border-border-soft tw:px-4 tw:py-2 tw:text-xs tw:whitespace-nowrap tw:text-muted-foreground tw:tabular-nums">
          Обновлено {sinceLabel(lastUpdatedAt).replace(/^с /, "в ")} · ночной
          сброс, кроме {longLivedEmojis}
        </div>
      )}
    </aside>
  );
};

export default WorkStatusBar;

import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCalendar2Line,
} from "react-icons/ri";
import { Link, useMatch } from "react-router";

import { cn } from "@/lib/utils";

import { timeLabel } from "./presence";
import WorkStatusAvatar from "./WorkStatusAvatar";

// Кирпичи табло присутствия — общие для рейла статусов (десктоп) и блока
// «Команда сейчас» на главной (телефон): заголовок группы цветом статуса,
// строка человека, свёрнутая группа со счётчиком, выход в календарь команды.
//
// Кегль строк 14/12 — исключение из шкалы списков (16/14): это боковая
// панель шириной 336 и плотный блок, а не список-страница (см. «Типографика»).

// Uppercase-заголовок группы цветом статуса, счётчик — приглушённый
export const GroupHeading = ({ status, count, className }) => {
  const Icon = status.icon;
  return (
    <p
      className={cn(
        "my-0 flex items-center gap-1.5 text-xs font-bold tracking-wider whitespace-nowrap uppercase",
        className,
      )}
      style={{ color: status.color }}
    >
      {Icon && <Icon size={14} aria-hidden className="flex-none" />}
      {status.label}
      <span className="font-semibold tracking-normal text-faint">· {count}</span>
    </p>
  );
};

// Строка сотрудника: имя, под ним время («с …» / «до …») и заметка одной
// строкой через « · ». Статус строка НЕ повторяет: она всегда стоит под
// заголовком своей группы, а цвет несут кольцо и бейдж аватара — со статусом
// в строке и заметкой автоматики «Отпуск до 04.10» слово стояло трижды подряд.
// `muted` — для тех, кого нет (отпуск, больничный): видны, но не спорят с
// теми, кто на связи.
export const PersonRow = ({ user, status, size = 38, muted = false, className }) => {
  const line = [timeLabel(user, status), user.workStatus?.note]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-2.5 px-4 py-1 transition-colors hover:bg-accent",
        className,
      )}
    >
      <WorkStatusAvatar
        size={size}
        firstName={user.firstName}
        lastName={user.lastName}
        profileImagePath={user.profileImagePath}
        workStatus={user.workStatus}
      />
      <span className="min-w-0 flex-1 leading-snug">
        <span
          className={cn(
            "block truncate text-sm font-semibold",
            muted && "font-medium text-muted-foreground",
          )}
        >
          {user.lastName} {user.firstName}
        </span>
        {line && (
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {line}
          </span>
        )}
      </span>
    </div>
  );
};

// Свёрнутая группа «нет на месте» (не на работе, не указан): норма молчит —
// одна строка со счётчиком, раскрывается по клику. Люди внутри те же строки.
export const IdleGroup = ({
  status,
  users,
  open,
  onToggle,
  size = 38,
  className,
}) => {
  const Icon = status.icon;
  const Chevron = open ? RiArrowDownSLine : RiArrowRightSLine;
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent px-4 py-1.5 text-left text-xs font-bold tracking-wider whitespace-nowrap text-muted-foreground uppercase outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50"
      >
        {Icon && <Icon size={14} aria-hidden className="flex-none" />}
        {status.label}
        <span className="font-semibold tracking-normal text-faint">
          · {users.length}
        </span>
        <Chevron size={16} aria-hidden className="ms-auto flex-none text-faint" />
      </button>
      {open &&
        users.map((user) => (
          <PersonRow key={user._id} user={user} status={status} size={size} />
        ))}
    </div>
  );
};

// Последняя строка табло — выход в календарь команды (рейл раскрыт, блок
// «Команда сейчас» раскрыт). Пункта меню у календаря нет, поэтому на его
// странице строка подсвечена сама. Слот иконки 26 px — как у стрелки в шапке
// рейла. Право `schedule.read` проверяет вызывающий.
export const CalendarRow = ({ className }) => {
  const isActive = !!useMatch("/team/calendar/*");
  return (
    <Link
      to="/team/calendar"
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-2.5 border-t border-border-soft px-4 py-1.5 text-sm font-medium text-foreground no-underline transition-colors outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
        isActive && "bg-accent font-semibold",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-6.5 flex-none place-items-center",
          isActive ? "text-accent-text" : "text-muted-foreground",
        )}
      >
        <RiCalendar2Line size={16} />
      </span>
      Календарь команды
      {!isActive && (
        <RiArrowRightSLine
          size={16}
          aria-hidden
          className="ms-auto flex-none text-faint"
        />
      )}
    </Link>
  );
};

import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import { timeLabel } from "./presence";
import WorkStatusAvatar from "./WorkStatusAvatar";

// Кирпичи табло присутствия — общие для рейла статусов (десктоп) и блока
// «Команда сейчас» на главной (телефон): заголовок группы цветом статуса,
// строка человека, свёрнутая группа со счётчиком.
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

// Строка сотрудника: имя, статус текстом, время («с …» / «до …»), заметка.
// `muted` — для тех, кого нет (отпуск, больничный): видны, но не спорят с
// теми, кто на связи.
export const PersonRow = ({ user, status, size = 38, muted = false, className }) => (
  <div
    className={cn(
      "flex min-h-12 items-center gap-2.5 px-3.5 py-1 transition-colors hover:bg-accent",
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
      <span className="block truncate text-xs" style={{ color: status.color }}>
        {status.label}
        {timeLabel(user, status) && (
          <span className="text-muted-foreground tabular-nums">
            {" "}
            · {timeLabel(user, status)}
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

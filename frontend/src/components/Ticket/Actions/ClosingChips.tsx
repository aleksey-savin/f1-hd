import type { ReactNode, RefObject } from "react";

import { formatInTimeZone } from "date-fns-tz";
import { RiCheckLine, RiToolsLine } from "react-icons/ri";

import { cn } from "@/lib/utils";
import { orgTimezone } from "@/util/timezone-display";

import {
  OUTCOMES,
  SIGN_OFF,
  chipState,
  greetingAt,
  toggleGreeting,
  togglePart,
  toggleSignOff,
  workSentences,
} from "./closing-message";

/**
 * Телефон или планшет: фокус в поле открыл бы клавиатуру поверх чипов, поэтому
 * там поле не фокусируется ни при открытии диалога, ни после клика по чипу.
 */
export const isTouchPointer = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

const nowIn = (timezone: string, pattern: string) => {
  try {
    return formatInTimeZone(new Date(), timezone, pattern);
  } catch {
    return formatInTimeZone(new Date(), orgTimezone(), pattern);
  }
};

const Chip = ({
  on,
  title,
  icon,
  className,
  onClick,
  children,
}: {
  on: boolean;
  title?: string;
  /** Иконка в покое; горящий чип показывает галочку */
  icon?: ReactNode;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={on}
    title={title}
    onClick={onClick}
    className={cn(
      "inline-flex h-10 max-w-full cursor-pointer appearance-none items-center gap-1.5 rounded-full border border-input bg-transparent px-3.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-4 focus-visible:ring-ring/50 sm:h-8 sm:px-3 [&_svg]:-ms-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
      on &&
        "border-transparent bg-primary/15 text-accent-text hover:bg-primary/20 hover:text-accent-text",
      className,
    )}
  >
    {on ? <RiCheckLine aria-hidden /> : icon}
    {children}
  </button>
);

/**
 * Чипы быстрого заполнения «Результата выполнения» под полем диалога закрытия.
 * Порядок чипов — порядок сообщения: приветствие по времени заявителя · работы
 * этой заявки · строки итога · «Хорошего дня!». Куда встаёт текст и когда чип
 * горит — `closing-message.ts`.
 */
const ClosingChips = ({
  value,
  onChange,
  works = [],
  timezone,
  fieldRef,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Работы этой заявки; в массовом закрытии их нет — у каждой заявки свои */
  works?: { description?: string | null; finishedAt?: unknown }[];
  /** IANA-зона заявителя (`ticket.clientTimezone.timezone`); без неё — пояс организации */
  timezone?: string;
  /** Поле, куда на десктопе вернуть фокус с кареткой в конце */
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
}) => {
  const zone = timezone || orgTimezone();
  const greeting = greetingAt(Number(nowIn(zone, "H")));
  const state = chipState(value);
  const workTexts = workSentences(works);
  const order = [...workTexts, ...OUTCOMES];

  const apply = (next: string) => {
    onChange(next);
    const field = fieldRef?.current;
    if (!field || isTouchPointer()) return;
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(next.length, next.length);
    });
  };

  return (
    // contain-inline-size: длинный чип не распирает диалог. Содержимое
    // DialogContent — грид, а элемент грида не ужимается меньше своего
    // содержимого, и nowrap-текст раздвигал диалог вместо многоточия.
    <div
      role="group"
      aria-label="Быстрое заполнение"
      className="mt-2 flex flex-wrap items-center gap-2 contain-inline-size sm:gap-1.5"
    >
      <Chip
        on={Boolean(state.greeting)}
        title={
          timezone
            ? `У заявителя ${nowIn(zone, "HH:mm")} — в начало сообщения`
            : "В начало сообщения"
        }
        onClick={() => apply(toggleGreeting(value, greeting))}
      >
        <span>
          {state.greeting || greeting}
          <span className="text-faint"> …</span>
        </span>
      </Chip>

      {workTexts.map((work) => (
        <Chip
          key={work}
          on={state.has(work)}
          title={`Работа по заявке: ${work}`}
          icon={<RiToolsLine aria-hidden className="text-faint" />}
          className="sm:max-w-70"
          onClick={() => apply(togglePart(value, work, order))}
        >
          <span className="min-w-0 truncate">{work}</span>
        </Chip>
      ))}

      {OUTCOMES.map((outcome) => (
        <Chip
          key={outcome}
          on={state.has(outcome)}
          onClick={() => apply(togglePart(value, outcome, order))}
        >
          {outcome}
        </Chip>
      ))}

      <Chip
        on={state.signOff}
        title="В конец сообщения"
        onClick={() => apply(toggleSignOff(value))}
      >
        <span>
          <span className="text-faint">… </span>
          {SIGN_OFF}
        </span>
      </Chip>
    </div>
  );
};

export default ClosingChips;

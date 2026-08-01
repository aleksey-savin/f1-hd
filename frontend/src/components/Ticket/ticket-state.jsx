import { cn } from "@/lib/utils";

import {
  businessDaysAgo,
  formatDayMonth,
  formatDayMonthTime,
  formatTime,
} from "../../util/format-date";

/**
 * Каталог состояний заявки — единственный источник тонов для списка, карточки и
 * панели заявок на других экранах.
 *
 * Ось у цвета одна: **ждёт ли заявка человека**. «Новая» (никто не обработал),
 * «Не в работе» (обработана, но не принята) и «На согласовании» ждут решения —
 * янтарные. «В работе» — норма процесса, поэтому приглушена: подсвечивать норму
 * значит покрасить весь список и потерять на этом фоне то, что действительно
 * требует внимания.
 *
 * Просрочка состояние **не заменяет**: «в каком она состоянии» и «что с ней не
 * так» — разные вопросы, и заявка не перестаёт быть в работе оттого, что
 * просрочена. Просрочку несёт срок (красным) и, где есть место, отдельное слово
 * рядом со статусом.
 */
const TICKET_STATE_TONE = {
  Новая: "warn",
  "Не в работе": "warn",
  "На согласовании": "warn",
  "В работе": "normal",
  Выполнена: "normal",
  Закрыта: "off",
};

const TONE_TEXT = {
  warn: "text-warning",
  bad: "text-destructive",
  normal: "text-muted-foreground",
  off: "text-faint",
};

// Те же тона, но для шапки карточки: «норма» звучит в полный голос
const TONE_TEXT_STRONG = {
  warn: "text-warning",
  bad: "text-destructive",
  normal: "text-foreground",
  off: "text-muted-foreground",
};

export const TONE_DOT = {
  warn: "bg-warning",
  bad: "bg-destructive",
  normal: "bg-faint",
  off: "bg-faint",
};

/** Просрочена — дедлайн в прошлом и заявка ещё не завершена. */
export const isOverdue = (ticket) =>
  !!ticket?.deadline &&
  new Date(ticket.deadline) < new Date() &&
  !ticket.isClosed &&
  ticket.state !== "Выполнена";

/** Подпись и тон состояния строкой — статус заявки виден всегда. */
export const ticketTone = (ticket) => ({
  label: (ticket?.state || "").toLowerCase(),
  tone: TICKET_STATE_TONE[ticket?.state] ?? "normal",
});

/**
 * Срок строкой для списка и предпросмотра. Ближние дни — относительной меткой
 * («срок сегодня в 18:00»), дальние и прошедшие — компактной датой («срок до
 * 18.07, 05:00»): полная фраза с днём недели и месяцем прописью не помещалась в
 * колонку и переносилась на две строки. Просрочку называет цвет, а не слово, —
 * поэтому «срок до», а не «срок был».
 */
export const deadlineText = (deadline) => {
  if (!deadline) return "срок не задан";
  const days = businessDaysAgo(deadline);
  if (days === 0) return `срок сегодня в ${formatTime(deadline)}`;
  if (days === -1) return `срок завтра в ${formatTime(deadline)}`;
  if (days === 1) return `срок вчера в ${formatTime(deadline)}`;
  return `срок до ${formatDayMonthTime(deadline)}`;
};

/** «сегодня» · «вчера» · «18.07» — возраст заявки без слова. */
export const createdShort = (createdAt) => {
  const days = businessDaysAgo(createdAt);
  if (days === null) return "";
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  return formatDayMonth(createdAt);
};

/** «создана сегодня» · «создана 18.07» — там, где колонка не подписана. */
export const createdText = (createdAt) => {
  const short = createdShort(createdAt);
  return short ? `создана ${short}` : "";
};

/**
 * Цветной статус-текст с точкой — язык статус-борда, не заливной бейдж.
 *
 * `strong` — для шапки карточки: там статус отвечает на главный вопрос экрана и
 * не должен читаться как подпись. Тон «нормы» при этом становится обычным
 * текстом, а не приглушённым: в списке она молчит, потому что таких строк
 * десятки, а на карточке заявка одна.
 *
 * НЕ inline-flex, хотя точка с текстом просятся во флекс. У флекс-контейнера
 * базовая линия берётся от ПЕРВОГО элемента, а первый здесь — пустая точка без
 * текста: её базовую линию браузер синтезирует по нижнему краю, и весь статус
 * уезжает вниз относительно соседей. В шапке заявки из-за этого номер, статус и
 * срок стояли на трёх разных высотах. Обычный строчный поток: точка —
 * inline-block с align-middle, отступ — margin, а не gap.
 */
export const TicketStateText = ({
  tone = "normal",
  strong = false,
  className,
  children,
}) => (
  <span
    className={cn(
      "text-sm whitespace-nowrap",
      strong ? TONE_TEXT_STRONG[tone] : TONE_TEXT[tone],
      strong && "font-semibold",
      className,
    )}
  >
    <span
      aria-hidden
      className={cn(
        "me-1.5 inline-block size-1.5 rounded-full align-middle",
        TONE_DOT[tone],
      )}
    />
    {children}
  </span>
);

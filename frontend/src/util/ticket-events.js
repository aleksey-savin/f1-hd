import {
  RiAddCircleLine,
  RiArrowGoBackLine,
  RiAttachment2,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiEdit2Line,
  RiInformationLine,
  RiListCheck2,
  RiPlayCircleLine,
  RiTimeLine,
  RiToolsLine,
  RiUserAddLine,
  RiUserFollowLine,
  RiUserVoiceLine,
} from "react-icons/ri";

/**
 * Как событие заявки превращается в строку хроники: иконка, тон и подпись.
 *
 * Вид (`kind`) приходит с бэкенда — там же и каталог видов
 * (`services/ticketEvents.js`); здесь только то, что видит пользователь.
 * Собственный текст записи (`event`) в ленте не показываем: он написан для
 * лога, а не для человека («запросил(а) помощь, изменён список ответственных»).
 * Исключение — «прочее»: вид неизвестен, и текст лучше, чем ничего.
 */
const EVENT_META = {
  created: { icon: RiAddCircleLine, label: "Создана", tone: "muted" },
  processed: { icon: RiCheckboxCircleLine, label: "Обработана", tone: "muted" },
  taken: { icon: RiPlayCircleLine, label: "Принята в работу", tone: "ok" },
  takenOver: { icon: RiUserFollowLine, label: "Взята на себя", tone: "ok" },
  joined: {
    icon: RiUserAddLine,
    label: "Присоединился к работе",
    tone: "muted",
  },
  helpRequested: {
    icon: RiUserVoiceLine,
    label: "Запрошена помощь",
    tone: "warn",
  },
  deadline: { icon: RiTimeLine, label: "Срок изменён", tone: "muted" },
  updated: { icon: RiEdit2Line, label: "Заявка изменена", tone: "muted" },
  workAdded: { icon: RiToolsLine, label: "Добавлены работы", tone: "ok" },
  workUpdated: { icon: RiToolsLine, label: "Работы изменены", tone: "muted" },
  // Подпись берётся из текста записи: «составлен ИИ», «составлен», «изменён» —
  // три разных факта, и в истории они должны различаться (составление ИИ —
  // самый дешёвый путь завести чек-лист, по нему и судим, работает ли фича)
  checklist: {
    icon: RiListCheck2,
    label: (event) =>
      /составлен ИИ/i.test(event?.event ?? "")
        ? "Чек-лист составлен ИИ"
        : /^составлен чек-лист/i.test(event?.event ?? "")
          ? "Чек-лист составлен"
          : "Чек-лист обновлён",
    tone: "muted",
  },
  // Подпись зависит от числа файлов, поэтому функция: «Прикреплён файл» против
  // «Прикреплено 3 файла» — разные фразы об одном событии
  attachmentAdded: {
    icon: RiAttachment2,
    label: (event) =>
      (event?.files?.length ?? 1) === 1
        ? "Прикреплён файл"
        : `Прикреплено файлов: ${event.files.length}`,
    tone: "muted",
  },
  attachmentRemoved: {
    icon: RiCloseCircleLine,
    label: "Файл удалён",
    tone: "muted",
  },
  rejected: { icon: RiCloseCircleLine, label: "Отказ от заявки", tone: "bad" },
  closed: { icon: RiCheckboxCircleLine, label: "Закрыта", tone: "ok" },
  reopened: {
    icon: RiArrowGoBackLine,
    label: "Возвращена в работу",
    tone: "warn",
  },
  other: { icon: RiInformationLine, label: null, tone: "muted" },
};

export const eventMeta = (kind) => EVENT_META[kind] ?? EVENT_META.other;

/**
 * Подпись записи. У каталожного вида она своя, у «прочего» показываем текст
 * лога: вид неизвестен, и он лучше, чем ничего.
 */
export const eventLabel = (event) => {
  const { label } = eventMeta(event?.kind);
  if (typeof label === "function") return label(event);
  return label ?? event?.event;
};

export const EVENT_TONE_CLASS = {
  ok: "text-accent-text border-primary/35",
  warn: "text-warning border-warning/35",
  bad: "text-destructive border-destructive/35",
  muted: "text-faint border-border-soft",
};

/** «6 уведомлений · 2 не доставлены» — свёрнутая группа служебных записей. */
export const technicalSummary = ({ count = 0, failed = 0 } = {}) => {
  if (!count) return null;
  const word =
    count % 10 === 1 && count % 100 !== 11
      ? "запись"
      : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)
        ? "записи"
        : "записей";
  return failed > 0
    ? `${count} служебных ${word} · ${failed} с ошибкой`
    : `${count} служебных ${word}`;
};

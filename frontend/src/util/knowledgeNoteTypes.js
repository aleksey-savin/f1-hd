import {
  RiShieldCheckLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiGuideLine,
  RiBug2Line,
  RiArchiveLine,
  RiDeleteBin6Line,
  RiShieldKeyholeLine,
} from "react-icons/ri";

import { formatShortDate } from "./format-date";

// Типы заметок базы знаний — единый источник меток, иконок и приоритета.
// priority задаёт значимость типа при ранжировании связанных заметок на заявке:
// backlog (известные проблемы) > instructions > info. Значения value и priority
// дублируются на бэкенде (services/knowledgeBaseContext.js, TYPE_PRIORITY) —
// менять только синхронно.
//
// `badge` (вариант bootstrap) остался ради легаси-панели заметок на странице
// заявки: в целевой системе тип цветом НЕ передаётся — его несёт иконка, а цвет
// отдан состоянию заметки (см. getNoteFlags и docs/ux-ui-guide.md).
export const NOTE_TYPES = [
  {
    value: "info",
    label: "Информация",
    badge: "primary",
    priority: 1,
    icon: RiInformationLine,
  },
  {
    value: "backlog",
    label: "Бэклог",
    badge: "warning",
    priority: 3,
    icon: RiBug2Line,
  },
  {
    value: "instructions",
    label: "Инструкции",
    badge: "success",
    priority: 2,
    icon: RiGuideLine,
  },
];

// Метаданные типа по его значению; неизвестный/пустой тип трактуется как "info".
export const getNoteTypeMeta = (value) =>
  NOTE_TYPES.find((type) => type.value === value) || NOTE_TYPES[0];

// В интерфейсе состояние называется «Проверено», в БД — approved/approvedBy/
// approvedAt. Поля не переименовывали: переименование задело бы модель, крон
// истечения проверки, настройки и deep-link'и, не дав ничего пользователю.
// approved !== true: заметки без поля approved тоже считаем непроверенными.
export const getApprovalMeta = (note) =>
  note?.approved !== true
    ? { icon: RiErrorWarningLine, bg: "warning", label: "Не проверено" }
    : { icon: RiShieldCheckLine, bg: "success", label: "Проверено" };

// «Иванов И.» — фамилия и инициал. Пустой пользователь → null, чтобы вызывающий
// код мог опустить всю часть фразы, а не печатать «· undefined ·».
export const formatActor = (user) => {
  if (!user) {
    return null;
  }
  const lastName = (user.lastName || "").trim();
  const firstName = (user.firstName || "").trim();
  if (!lastName) {
    return firstName || null;
  }
  return firstName ? `${lastName} ${firstName[0]}.` : lastName;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Состояние доверия к заметке одной структурой: кто, когда и сколько ещё
// действует проверка. Отсюда собирается «строка доверия» на странице заметки.
// approvalPeriodDays = 0 → проверка бессрочна, срок не показываем.
export const getVerificationSummary = (note, { approvalPeriodDays = 0 } = {}) => {
  const meta = getApprovalMeta(note);
  const verified = note?.approved === true;

  if (!verified) {
    return {
      ...meta,
      verified: false,
      // Кто последним изменил заметку — именно правка снимает отметку.
      actorName: formatActor(note?.updatedBy),
      at: note?.updatedAt ? formatShortDate(note.updatedAt) : null,
      daysLeft: null,
      expiresSoon: false,
    };
  }

  let daysLeft = null;
  if (approvalPeriodDays > 0 && note.approvedAt) {
    const elapsed = (Date.now() - new Date(note.approvedAt)) / DAY_MS;
    daysLeft = Math.max(0, Math.ceil(approvalPeriodDays - elapsed));
  }

  return {
    ...meta,
    verified: true,
    actorName: formatActor(note.approvedBy),
    at: note.approvedAt ? formatShortDate(note.approvedAt) : null,
    daysLeft,
    expiresSoon: daysLeft !== null && daysLeft <= 7,
  };
};

// Состояния-исключения заметки для строки списка. Проверенная заметка не
// показывает НИЧЕГО: это норма, а место в узком рейле дороже подтверждения
// нормы. Значок появляется только там, где с заметкой что-то не так или её
// ждёт решение; порядок — от самого срочного. tone раскрашивает вызывающий
// компонент (util не знает про классы).
export const getNoteFlags = (note, { approvalPeriodDays = 0 } = {}) => {
  if (!note) {
    return [];
  }

  const flags = [];

  if (note.pendingDeletion) {
    flags.push({
      key: "deletion",
      icon: RiDeleteBin6Line,
      tone: "danger",
      title: "Запрошено удаление",
    });
  }
  if (note.secretsScan?.flagged) {
    flags.push({
      key: "secrets",
      icon: RiShieldKeyholeLine,
      tone: "warning",
      title: "Найдены учётные данные",
    });
  }
  if (note.approved !== true) {
    flags.push({
      key: "unapproved",
      icon: RiErrorWarningLine,
      tone: "warning",
      title: "Не проверено",
    });
  } else {
    const { daysLeft, expiresSoon } = getVerificationSummary(note, {
      approvalPeriodDays,
    });
    if (expiresSoon) {
      flags.push({
        key: "expiring",
        icon: RiShieldCheckLine,
        tone: "warning",
        title:
          daysLeft === 0
            ? "Проверка истекает сегодня"
            : `Проверка истекает через ${daysLeft} дн.`,
      });
    }
  }
  if (note.pendingArchive) {
    flags.push({
      key: "archive",
      icon: RiArchiveLine,
      tone: "faint",
      title: "Ожидает архивации",
    });
  }

  return flags;
};

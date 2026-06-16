import { RiCheckboxCircleLine, RiErrorWarningLine } from "react-icons/ri";

// Типы заметок базы знаний — единый источник меток, цветов бейджей и приоритета.
// priority задаёт значимость типа при ранжировании связанных заметок на заявке:
// backlog (известные проблемы) > instructions > info.
export const NOTE_TYPES = [
  { value: "info", label: "Информация", badge: "primary", priority: 1 },
  { value: "backlog", label: "Бэклог", badge: "warning", priority: 3 },
  { value: "instructions", label: "Инструкции", badge: "success", priority: 2 },
];

// Метаданные типа по его значению; неизвестный/пустой тип трактуется как "info".
export const getNoteTypeMeta = (value) =>
  NOTE_TYPES.find((type) => type.value === value) || NOTE_TYPES[0];

// Бейдж статуса одобрения (показывается перед заголовком и в списках).
// approved !== true: заметки без поля approved тоже считаем неодобренными.
export const getApprovalMeta = (note) =>
  note?.approved !== true
    ? { icon: RiErrorWarningLine, bg: "warning", label: "Не одобрено" }
    : { icon: RiCheckboxCircleLine, bg: "success", label: "Одобрено" };

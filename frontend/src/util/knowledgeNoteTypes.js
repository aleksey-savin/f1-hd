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

import { businessDaysAgo } from "./format-date";

// Человекочитаемая «последняя активность» для адресной книги: гранулярность —
// день (когда пользователь последний раз обращался, по дате его последней
// заявки). Возвращает null, если даты нет.
//
// День считается в бизнес-таймзоне (businessDaysAgo), а не в браузерной:
// иначе сотрудник, открывший адресную книгу западнее организации, видел бы
// «вчера» там, где у компании ещё сегодня.
export function relativeDay(input) {
  const days = businessDaysAgo(input);
  if (days === null) return null;

  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн. назад`;
  if (days < 31) return `${Math.round(days / 7)} нед. назад`;
  if (days < 365) return `${Math.max(1, Math.round(days / 30))} мес. назад`;
  return `${Math.max(1, Math.round(days / 365))} г. назад`;
}

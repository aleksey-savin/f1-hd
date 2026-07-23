// Человекочитаемая «последняя активность» для адресной книги: гранулярность —
// день (когда пользователь последний раз обращался, по дате его последней
// заявки). Возвращает null, если даты нет.
export function relativeDay(input) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;

  const startOfDay = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);

  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн. назад`;
  if (days < 31) return `${Math.round(days / 7)} нед. назад`;
  if (days < 365) return `${Math.max(1, Math.round(days / 30))} мес. назад`;
  return `${Math.max(1, Math.round(days / 365))} г. назад`;
}

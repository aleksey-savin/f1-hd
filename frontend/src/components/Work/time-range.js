// Время работы одной фразой для свёрнутого блока «Время работы» в форме:
// «Сегодня, 13:50 – 14:20». Значения — строки формы «YYYY-MM-DDTHH:mm» в
// бизнес-таймзоне, поэтому день — это их первые десять символов.
//
// Относительные метки — по канону гайда («Даты и время на экране»): сегодня /
// вчера, дальше дата. Сегодняшний день и формат даты передаёт вызывающий
// (`businessDayKey`, `formatDayKey`): модуль без импортов, его гоняет node --test.

const previousDay = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
};

const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

/**
 * @param {string} startedAt «YYYY-MM-DDTHH:mm» или «»
 * @param {string} finishedAt «YYYY-MM-DDTHH:mm» или «»
 * @param {{ today: string, formatDay: (key: string) => string }} options
 * @returns {string} «» — пока не заданы оба края
 */
export const formatWorkRange = (startedAt, finishedAt, { today, formatDay }) => {
  if (!startedAt || !finishedAt) return "";

  const dayOf = (value) => {
    const key = value.slice(0, 10);
    if (key === today) return "сегодня";
    if (key === previousDay(today)) return "вчера";
    return formatDay(key);
  };
  const timeOf = (value) => value.slice(11, 16);

  const startDay = dayOf(startedAt);
  if (startedAt.slice(0, 10) === finishedAt.slice(0, 10)) {
    return `${capitalize(startDay)}, ${timeOf(startedAt)} – ${timeOf(finishedAt)}`;
  }
  return `${capitalize(startDay)} ${timeOf(startedAt)} – ${dayOf(finishedAt)} ${timeOf(finishedAt)}`;
};

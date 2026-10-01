/**
 * Фильтр периода в конвейере «Согласования работ».
 *
 * Месяц отчёта — календарный месяц в поясе ОРГАНИЗАЦИИ, и ключом («2026-09»)
 * его присылает сервер. Брать его из `periodFrom` нельзя: это момент — полночь
 * первого числа в поясе организации, и в UTC он попадает на последний день
 * предыдущего месяца. Сентябрьский отчёт при таком разборе уезжал в август.
 */

type Range = { from: string; to: string };

const monthOf = (value: string) => (value ? String(value).slice(0, 7) : "");

/** Ключ месяца отчёта; старый ответ без `month` — по началу периода. */
export const reportMonthKey = (row: {
  month?: string | null;
  periodFrom?: string | null;
}) => row.month || monthOf(row.periodFrom || "");

/** Попадает ли месяц в период степпера; пустой период — фильтра нет. */
export const inMonthRange = (month: string, range: Range) => {
  if (!range.from || !range.to) return true;
  return month >= monthOf(range.from) && month <= monthOf(range.to);
};

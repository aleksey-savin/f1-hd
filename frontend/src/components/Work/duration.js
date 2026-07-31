// Длительность работы: миллисекунды → «Ч:ММ» (формат легаси-отчёта, но без
// секунд). Делят строка работы и сводка «Суммарное время выборки».
export const formatDuration = (ms) => {
  const totalMinutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
};

// Длительность словами: «1 ч 30 мин», «45 мин», «2 ч». Нужна там, где число
// стоит в предложении, а не в колонке: форма работы и блок «вне графика».
// Легаси-`formatOvertimeMinutes` давал «1 часов 1 минут» и печатал дробные
// минуты (сутки считаются до 23:59:59.999) — здесь минуты целые.
export const formatDurationWords = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  if (hours === 0) {
    return `${rest} мин`;
  }

  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
};

// Порог «подозрительно длинной» работы — такие длительности показываются
// warning-тоном (легаси подсвечивал строку целиком классом table-warning)
export const LONG_WORK_MS = 12 * 60 * 60 * 1000;

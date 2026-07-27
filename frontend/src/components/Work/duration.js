// Длительность работы: миллисекунды → «Ч:ММ» (формат легаси-отчёта, но без
// секунд). Делят строка работы и сводка «Суммарное время выборки».
export const formatDuration = (ms) => {
  const totalMinutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
};

// Порог «подозрительно длинной» работы — такие длительности показываются
// warning-тоном (легаси подсвечивал строку целиком классом table-warning)
export const LONG_WORK_MS = 12 * 60 * 60 * 1000;

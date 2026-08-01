// Длительность «ЧЧ:ММ» из миллисекунд. Таймзоно-агностично: это интервал, а не
// момент времени. Расписания и «следующее выполнение» живут в util/cron.js.
//
// Часы НЕ обрезаются по суткам: 30 часов работ за месяц — это «30:00», а не
// «06:00».
export const msToHMS = (ms) => {
  // trunc, а не floor: прежняя редакция считала через parseInt, и на
  // отрицательном интервале floor дал бы другой результат
  const totalMinutes = Math.trunc(ms / 60000);
  const hours = Math.trunc(totalMinutes / 60);
  const minutes = Math.abs(totalMinutes % 60);

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
  ].join(":");
};

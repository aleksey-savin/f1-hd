import pad from "pad";

// Длительность «ЧЧ:ММ» из миллисекунд. Таймзоно-агностично: это интервал, а не
// момент времени. Расписания и «следующее выполнение» живут в util/cron.js.
export const msToHMS = (ms) => {
  // 1- Convert to seconds:
  let seconds = ms / 1000;
  // 2- Extract hours:
  const hours = parseInt(seconds / 3600); // 3,600 seconds in 1 hour
  seconds = seconds % 3600; // seconds remaining after extracting hours
  // 3- Extract minutes:
  const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
  // 4- Keep only seconds not extracted to minutes:
  seconds = seconds % 60;

  const humanized = [
    pad(2, hours.toString(), "0"),
    pad(2, minutes.toString(), "0"),
  ].join(":");

  return humanized;
};

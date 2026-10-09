// Validation of Mikrotik monitoring input that has no verify-on-save behind it.

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_WINDOWS = 7;

// Planned offline windows from a request body. Returns { windows } (cleaned —
// unknown keys dropped, days unique and sorted) or { error } with a message for
// the operator.
const parsePlannedOffline = (body) => {
  const raw = body?.windows;
  if (!Array.isArray(raw)) return { error: "Не переданы окна отключения" };
  if (raw.length > MAX_WINDOWS) {
    return { error: `Не больше ${MAX_WINDOWS} окон на устройство` };
  }

  const windows = [];
  for (const item of raw) {
    const days = Array.isArray(item?.days) ? [...new Set(item.days.map(Number))] : [];
    if (
      days.length === 0 ||
      !days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ) {
      return { error: "Выберите дни недели для каждого окна" };
    }
    if (!CLOCK.test(item.start) || !CLOCK.test(item.end)) {
      return { error: "Укажите начало и конец окна в формате ЧЧ:ММ" };
    }
    if (item.start === item.end) {
      return { error: "Начало и конец окна не должны совпадать" };
    }
    windows.push({
      days: days.sort((a, b) => a - b),
      start: item.start,
      end: item.end,
    });
  }
  return { windows };
};

module.exports = { parsePlannedOffline };

const User = require("@/models/user");

/**
 * «Вести финансовый учёт» (`user.trackFinances`) — ведём ли мы у человека
 * оклад, ставку переработок и норму по графику.
 *
 * Выключают его сотрудникам сторонних компаний: заявки они берут и работы
 * записывают, но зарплату им платим не мы. Без учёта человека нет в отчёте
 * «Сотрудники» (статистика, переработки, динамика, блок «Команда» на главной),
 * оклад и ставка не применяются, режим «по графику» недоступен — норма и
 * переработки считаются только по нему. Клиентских отчётов и стоимости работ
 * это не касается: то расчёт с клиентом, а не с исполнителем.
 *
 * ПРАВИЛО ОДНО на все выборки — здесь: три отчёта отбирали сотрудников тремя
 * разными запросами, и добавь условие в два из них — третий молча вернул бы
 * человека в ленту.
 *
 * Поле появилось 2026-09-21, у прежних документов его нет: отсутствие значит
 * «ведётся». Поэтому везде `!== false` и `$ne: false`, а не `=== true`.
 */
const TRACKED_FILTER = { trackFinances: { $ne: false } };

const tracksFinances = (user) => user?.trackFinances !== false;

/**
 * Режим рабочего времени с учётом признака: «по графику» без финансового учёта
 * превращается в свободный — человек остаётся в календаре, но автоматика и
 * норма его не касаются. Прежний график не стирается: вернут учёт — заработает.
 */
const workTimeModeFor = (mode, user) =>
  !tracksFinances(user) && mode === "scheduled" ? "free" : mode;

/** Идентификаторы людей без учёта — для выборок, где исполнитель приходит из работ. */
const untrackedUserIds = async () => {
  const rows = await User.find({ trackFinances: false }).select("_id").lean();
  return new Set(rows.map((row) => row._id.toString()));
};

/** Работы без тех, чей исполнитель учёта не ведёт. Работа без исполнителя остаётся. */
const withoutUntracked = (works = [], untracked = new Set()) =>
  untracked.size
    ? works.filter(
        (work) => !untracked.has(work?.finishedBy?._id?.toString?.() ?? ""),
      )
    : works;

module.exports = {
  TRACKED_FILTER,
  tracksFinances,
  workTimeModeFor,
  untrackedUserIds,
  withoutUntracked,
};

// node --test services/ticketActivity.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveRules,
  isMachineTicket,
  isEligible,
  businessDaysBetween,
  computeStale,
} = require("./ticketActivity");

// Календарь-заглушка: суббота и воскресенье нерабочие, плюс перечисленные
// праздники. Настоящий (productionCalendar) отдаёт ровно такой же `kind`.
const fakeCalendar = (holidays = []) => {
  const set = new Set(holidays);
  return {
    classify: (key) => {
      if (set.has(key)) return { kind: "holiday" };
      const [y, m, d] = key.split("-").map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return { kind: dow === 0 || dow === 6 ? "weekend" : "work" };
    },
  };
};

const TZ = "Europe/Moscow";
const NOW = new Date("2026-09-09T10:00:00Z"); // среда

test("resolveRules: пустые настройки дают дефолты", () => {
  assert.deepEqual(resolveRules(undefined), {
    thresholdDays: 7,
    ignoreAuto: true,
    ignoreUnassigned: true,
  });
});

test("resolveRules: битый порог не роняет срез", () => {
  assert.equal(resolveRules({ staleTickets: { thresholdDays: 0 } }).thresholdDays, 7);
  assert.equal(resolveRules({ staleTickets: { thresholdDays: "" } }).thresholdDays, 7);
  assert.equal(resolveRules({ staleTickets: { thresholdDays: 3.7 } }).thresholdDays, 3);
});

test("resolveRules: переключатели выключаются только явным false", () => {
  const rules = resolveRules({
    staleTickets: { ignoreAuto: false, ignoreUnassigned: false },
  });
  assert.equal(rules.ignoreAuto, false);
  assert.equal(rules.ignoreUnassigned, false);
});

test("машинная заявка — мониторинг или заявка без человека", () => {
  assert.equal(
    isMachineTicket({ source: "Мониторинг устройств", applicantId: "u1" }),
    true,
  );
  assert.equal(isMachineTicket({ source: "Почта" }), true);
  assert.equal(isMachineTicket({ source: "Почта", applicantId: "u1" }), false);
  // Регламентное задание заводит крон, но работает по нему человек
  assert.equal(
    isMachineTicket({ source: "Регламентное задание", applicantId: "u1" }),
    false,
  );
});

test("зачёт слушается настроек", () => {
  const machine = { source: "Мониторинг устройств", responsibles: [{ _id: "u" }] };
  const free = { source: "Почта", applicantId: "u1", responsibles: [] };

  const strict = { thresholdDays: 7, ignoreAuto: true, ignoreUnassigned: true };
  assert.equal(isEligible(machine, strict), false);
  assert.equal(isEligible(free, strict), false);

  const loose = { thresholdDays: 7, ignoreAuto: false, ignoreUnassigned: false };
  assert.equal(isEligible(machine, loose), true);
  assert.equal(isEligible(free, loose), true);
});

test("рабочие дни считаются без выходных и праздников", () => {
  const calendar = fakeCalendar();
  // пятница → среда: суббота и воскресенье не в счёт, день движения тоже
  assert.equal(businessDaysBetween("2026-09-04", "2026-09-09", calendar), 3);
  // тот же день — ноль
  assert.equal(businessDaysBetween("2026-09-09", "2026-09-09", calendar), 0);
  // праздник во вторник убирает один день
  assert.equal(
    businessDaysBetween("2026-09-04", "2026-09-09", fakeCalendar(["2026-09-08"])),
    2,
  );
});

test("сокращённый предпраздничный день — рабочий", () => {
  const calendar = { classify: () => ({ kind: "short" }) };
  assert.equal(businessDaysBetween("2026-09-07", "2026-09-09", calendar), 2);
});

const ticket = (overrides) => ({
  _id: "t1",
  source: "Почта",
  applicantId: "u1",
  responsibles: [{ _id: "r1" }],
  createdAt: new Date("2026-08-01T09:00:00Z"),
  ...overrides,
});

const staleOf = (tickets, moved, rules) =>
  computeStale(tickets, {
    rules: { thresholdDays: 3, ignoreAuto: true, ignoreUnassigned: true, ...rules },
    moved,
    calendar: fakeCalendar(),
    timezone: TZ,
    now: NOW,
  });

test("порог: ровно порог — уже в срезе, на день меньше — нет", () => {
  const moved = new Map([
    ["t1", new Date("2026-09-04T09:00:00Z")], // пятница → 3 рабочих дня
    ["t2", new Date("2026-09-07T09:00:00Z")], // понедельник → 2 рабочих дня
  ]);
  const [first, second] = staleOf([ticket(), ticket({ _id: "t2" })], moved);
  assert.equal(first.silentDays, 3);
  assert.equal(first.isStale, true);
  assert.equal(second.silentDays, 2);
  assert.equal(second.isStale, false);
});

test("без записей в хронике движением считается создание заявки", () => {
  const [only] = staleOf(
    [ticket({ createdAt: new Date("2026-09-08T09:00:00Z") })],
    new Map(),
  );
  assert.equal(only.silentDays, 1);
  assert.equal(only.isStale, false);
});

test("не попавшая в зачёт заявка молчит, но в срез не идёт", () => {
  const moved = new Map([["t1", new Date("2026-08-03T09:00:00Z")]]);
  const [machine] = staleOf([ticket({ source: "Мониторинг устройств" })], moved);
  assert.ok(machine.silentDays > 3, "молчание считается всем");
  assert.equal(machine.isStale, false);

  const [counted] = staleOf(
    [ticket({ source: "Мониторинг устройств" })],
    moved,
    { ignoreAuto: false },
  );
  assert.equal(counted.isStale, true);
});

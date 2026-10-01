// Общий образец карточки отчёта для тестов выгрузки (export-*.test.js).
// Не тест и не боевой код: только данные.

const work = (over) => ({
  _id: over.id,
  description: over.description || "Работа",
  startedAt: over.startedAt || "2026-08-15T00:30:00.000Z",
  finishedBy: { firstName: "Дмитрий", lastName: "Орлов" },
  tickets: [
    {
      _id: `t-${over.id}`,
      num: over.num || 51713,
      applicantId: { firstName: "Анна", lastName: "Петрова" },
    },
  ],
  subdivision: over.subdivision ? { _id: "s1", name: over.subdivision } : null,
  billedMinutes: over.minutes,
  cost: over.cost,
});

export const sampleReport = {
  _id: "r1",
  status: "approved",
  month: "2026-08",
  period: "август 2026",
  periodFrom: "2026-07-31T14:00:00.000Z",
  company: { _id: "c1", alias: "Альфа-Строй", fullTitle: "ООО «Альфа-Строй»" },
  contractor: { _id: "c0", alias: "ИТ-Сервис" },
  servicePlan: { _id: "s1", title: "Абонентское обслуживание" },
  worksCount: 5,
  approval: { required: true, bySubdivisions: false, autoApprovedAt: null },
  timeline: [
    {
      action: "submitted",
      actor: "contractor",
      at: "2026-09-01T03:00:00.000Z",
    },
    {
      action: "approved",
      actor: "customer",
      scope: "report",
      at: "2026-09-03T03:00:00.000Z",
      by: { firstName: "Сергей", lastName: "Иванов" },
    },
  ],
  terms: {
    type: "fixedPrice",
    tariffingPeriod: 30,
    fixedPrice: 120000,
    pricePerHourNonWorking: 1250.5,
  },
  calc: {
    workingTimeMinutes: 210,
    overtimeMinutes: 750,
    price: 120000,
    additionalPrice: 15631.25,
    total: 135631.25,
  },
  overtimeWorks: [
    work({ id: "w1", minutes: 240, cost: 5002, subdivision: "Филиал «Север»" }),
    work({ id: "w2", minutes: 150, cost: 3126.25, num: 51764 }),
    work({ id: "w3", minutes: 360, cost: 7503, num: 51802 }),
  ],
  worktimeWorks: [
    work({ id: "w4", minutes: 60, num: 51690 }),
    work({ id: "w5", minutes: 150, num: 51731 }),
  ],
};

// Форматтеры подставные: настоящие читают пояс и локаль браузера
export const sampleFormatters = {
  shortDate: (value) => `<${new Date(value).toISOString().slice(0, 10)}>`,
  zoneLabel: "Владивосток (UTC+10)",
};

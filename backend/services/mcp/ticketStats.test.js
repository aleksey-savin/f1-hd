// node --test services/mcp/ticketStats.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { aggregateTicketStats } = require("./ticketStats");

const row = (over) => ({
  categoryId: "k1", company: { _id: "c1" }, applicantId: "u1", source: "Почта",
  isClosed: true, createdAt: new Date("2026-09-01T00:00:00Z"), finishedAt: new Date("2026-09-01T02:00:00Z"),
  ...over,
});
const labelOf = (groupBy, key) => `${groupBy}:${key}`;

test("groups count open and closed tickets and the median time to close", () => {
  const rows = [
    row({ categoryId: "k1", finishedAt: new Date("2026-09-01T01:00:00Z") }), // 1 ч
    row({ categoryId: "k1", finishedAt: new Date("2026-09-01T03:00:00Z") }), // 3 ч
    row({ categoryId: "k1", isClosed: false, finishedAt: null }),
    row({ categoryId: "k2", finishedAt: new Date("2026-09-01T10:00:00Z") }), // 10 ч
    // Испорченные данные: закрыта раньше, чем создана — медиана не уходит в минус
    row({ categoryId: "k3", finishedAt: new Date("2026-08-31T23:00:00Z") }),
  ];

  const stats = aggregateTicketStats(rows, { groupBy: "category", timezone: "UTC", labelOf });

  assert.deepEqual([stats.total, stats.open, stats.closed], [5, 1, 4]);
  assert.deepEqual(stats.groups.map((g) => [g.label, g.tickets, g.open, g.closed, g.medianHours, g.share]), [
    ["category:k1", 3, 1, 2, 2, 60],
    ["category:k2", 1, 0, 1, 10, 20],
    ["category:k3", 1, 0, 1, 0, 20],
  ]);
});

test("months follow the organisation timezone and stay chronological", () => {
  const rows = [
    row({ createdAt: new Date("2026-09-30T14:00:00Z") }), // 01.10 во Владивостоке
    row({ createdAt: new Date("2026-08-31T14:00:00Z") }), // 01.09
    row({ createdAt: new Date("2026-08-31T13:00:00Z") }), // 31.08
  ];

  const stats = aggregateTicketStats(rows, { groupBy: "month", timezone: "Asia/Vladivostok", labelOf: (g, key) => key });

  assert.deepEqual(stats.groups.map((g) => [g.label, g.tickets]), [["2026-08", 1], ["2026-09", 1], ["2026-10", 1]]);
});

test("more than 50 groups fold into «остальные»; a group without closed tickets has no median", () => {
  const rows = Array.from({ length: 52 }, (_, i) => row({ applicantId: `u${i}`, isClosed: false, finishedAt: null }));

  const stats = aggregateTicketStats(rows, { groupBy: "applicant", timezone: "UTC", labelOf });

  assert.equal(stats.groups.length, 51);
  assert.deepEqual(stats.groups.at(-1), { key: "__rest", label: "остальные", tickets: 2, open: 2, closed: 0, medianHours: null, share: 3.8 });
  assert.equal(stats.groups[0].medianHours, null);
});

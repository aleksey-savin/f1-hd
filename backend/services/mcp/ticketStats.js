const { dayKey } = require("../../utils/datetime");

// Сводка по заявкам для ИИ-агента: считаем в коде по тонкой проекции, без
// $median (он есть только в MongoDB 7+, а переезд прода на 8 ещё идёт).
const TOP_GROUPS = 50;

const KEY_OF = {
  category: (row) => String(row.categoryId || ""),
  month: (row, tz) => dayKey(row.createdAt, tz).slice(0, 7),
  company: (row) => String(row.company?._id || ""),
  applicant: (row) => String(row.applicantId || ""),
  source: (row) => row.source || "",
};

const round1 = (value) => Math.round(value * 10) / 10;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round1(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

const aggregateTicketStats = (rows, { groupBy, timezone, labelOf }) => {
  const keyOf = KEY_OF[groupBy];
  const groups = new Map();
  let open = 0;
  let closed = 0;

  for (const row of rows) {
    const key = keyOf(row, timezone);
    const group = groups.get(key) || { key, tickets: 0, open: 0, closed: 0, hours: [] };
    group.tickets += 1;
    if (row.isClosed) {
      group.closed += 1;
      closed += 1;
      if (row.finishedAt) {
        // Ноль снизу: в испорченных данных закрытие бывает раньше создания, и
        // отрицательные часы утянули бы медиану группы в минус.
        group.hours.push(Math.max(0, (new Date(row.finishedAt) - new Date(row.createdAt)) / 3_600_000));
      }
    } else {
      group.open += 1;
      open += 1;
    }
    groups.set(key, group);
  }

  const total = rows.length;
  const share = (tickets) => (total ? round1((tickets / total) * 100) : 0);
  const finish = (group, label) => ({
    key: group.key,
    label,
    tickets: group.tickets,
    open: group.open,
    closed: group.closed,
    medianHours: median(group.hours),
    share: share(group.tickets),
  });

  let list = [...groups.values()];
  if (groupBy === "month") {
    list.sort((a, b) => a.key.localeCompare(b.key));
    return { total, open, closed, groups: list.map((g) => finish(g, labelOf(groupBy, g.key))) };
  }

  list.sort((a, b) => b.tickets - a.tickets || a.key.localeCompare(b.key));
  const top = list.slice(0, TOP_GROUPS).map((g) => finish(g, labelOf(groupBy, g.key)));
  const rest = list.slice(TOP_GROUPS);
  if (rest.length) {
    const merged = rest.reduce(
      (acc, g) => ({ ...acc, tickets: acc.tickets + g.tickets, open: acc.open + g.open, closed: acc.closed + g.closed, hours: acc.hours.concat(g.hours) }),
      { key: "__rest", tickets: 0, open: 0, closed: 0, hours: [] },
    );
    top.push(finish(merged, "остальные"));
  }
  return { total, open, closed, groups: top };
};

module.exports = { aggregateTicketStats };

/**
 * Статистика парка для ИИ-агента: чистая агрегация строк устройств
 * (inventorySource.deviceRows) и текст в стиле ticketFormat#formatStats.
 */

const FREE_STATUSES = ["readyForDeployment", "inReserve"];
const RETIRED_STATUSES = ["decommissioned", "disposed"];

const collator = new Intl.Collator("ru");
const percent = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0);

/**
 * rows → {total, groups:[{label, devices, free, deployed, inRepair, retired, share}]}.
 * `label(row)` отдаёт подпись группы или {key, label} (ключ — id). «Свободно» — как в списке устройств:
 * readyForDeployment | inReserve и не компонент (parentDeviceId пуст);
 * retired = decommissioned + disposed. Группы: по убыванию числа, затем по подписи.
 */
const aggregateInventoryStats = (rows, { label }) => {
  const groups = new Map();
  for (const row of rows) {
    // label(row) → строка или {key, label}: группа по ключу (id), подпись может совпадать у разных ключей
    const got = label(row);
    const { key, label: text } = typeof got === "string" ? { key: got, label: got } : got;
    if (!groups.has(key)) groups.set(key, { label: text, devices: 0, free: 0, deployed: 0, inRepair: 0, retired: 0 });
    const group = groups.get(key);
    group.devices += 1;
    if (FREE_STATUSES.includes(row.status) && !row.parentDeviceId) group.free += 1;
    if (row.status === "deployed") group.deployed += 1;
    if (row.status === "inRepair") group.inRepair += 1;
    if (RETIRED_STATUSES.includes(row.status)) group.retired += 1;
  }
  const total = rows.length;
  const list = [...groups.values()]
    .map((g) => ({ ...g, share: percent(g.devices, total) }))
    .sort((a, b) => b.devices - a.devices || collator.compare(a.label, b.label));
  return { total, groups: list };
};

const cell = (text) => String(text).replace(/\|/g, "/").replace(/\s+/g, " ").trim();

const formatInventoryStats = (stats, { groupBy, summary }) => {
  const header = `Devices: ${stats.total}, grouped by ${groupBy}${summary ? ` (${summary})` : ""}.`;
  if (!stats.total) return `${header}\nNo devices match.`;
  const rows = stats.groups.map(
    (g) => `| ${cell(g.label)} | ${g.devices} | ${g.free} | ${g.deployed} | ${g.inRepair} | ${g.retired} | ${g.share}% |`,
  );
  return [header, "", `| ${groupBy} | devices | free | deployed | in repair | retired | share |`, "|---|---|---|---|---|---|---|", ...rows].join("\n");
};

module.exports = { aggregateInventoryStats, formatInventoryStats };

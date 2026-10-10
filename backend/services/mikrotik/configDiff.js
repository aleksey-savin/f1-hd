// Отличия двух копий конфигурации: для агента (compare_mikrotik_exports) и для журнала устройства.
// На вход — уже вычищенные конфигурации (configRedact.redactConfig): секретов в строках нет.

// Разница двух вычищенных конфигураций по разделам: строки как мультимножества.
const diffConfigs = (older, newer) => {
  const linesOf = (config) => new Map(config.sections.map((section) => [section.path, section.lines]));
  const before = linesOf(older);
  const after = linesOf(newer);
  const changes = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(path) || [];
    const right = after.get(path) || [];
    const count = new Map();
    for (const line of left) count.set(line, (count.get(line) || 0) + 1);
    const added = [];
    for (const line of right) {
      const seen = count.get(line) || 0;
      if (seen) count.set(line, seen - 1);
      else added.push(line);
    }
    const removed = left.filter((line) => {
      const rest = count.get(line) || 0;
      if (rest) count.set(line, rest - 1);
      return rest > 0;
    });
    // Комментарии экспорта (дата, «# poe-out status …») меняются сами по себе
    const meaningful = (lines) => lines.filter((line) => !line.startsWith("#"));
    if (meaningful(added).length || meaningful(removed).length) {
      changes.push({ path, added: meaningful(added), removed: meaningful(removed) });
    }
  }
  return changes;
};

const MAX_SECTIONS = 12;

/**
 * Сводка отличий для события журнала: счётчики, затронутые меню и строки для показа.
 * Строки — «/меню», затем «- убрано» и «+ добавлено»; режет их services/mikrotik/events.js.
 */
const summarizeDiff = (changes) => {
  const list = Array.isArray(changes) ? changes : [];
  const lines = [];
  for (const change of list) {
    lines.push(change.path, ...change.removed.map((line) => `- ${line}`), ...change.added.map((line) => `+ ${line}`));
  }
  return {
    added: list.reduce((sum, change) => sum + change.added.length, 0),
    removed: list.reduce((sum, change) => sum + change.removed.length, 0),
    sections: list.slice(0, MAX_SECTIONS).map((change) => change.path),
    moreSections: Math.max(list.length - MAX_SECTIONS, 0),
    lines,
  };
};

module.exports = { diffConfigs, summarizeDiff, MAX_SECTIONS };

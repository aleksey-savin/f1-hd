// Что изменилось в записи устройства при сохранении параметров — для журнала устройства.
// Чистый модуль. Секреты (пароль, port knocking) попадают в список только именем поля: без значений.

const PLAIN = ["host", "port", "user", "sshPort", "label", "firmwareUpgradeEnabled"];
// Меняется ссылка на другую запись HD: в журнал идёт факт смены, название подставит чтение
const REFS = ["transit", "company"];
const SECRETS = ["password", "knock"];

const same = (a, b) => String(a ?? "") === String(b ?? "");

/**
 * before / after — плоские снимки: { host, port, user, sshPort, label, firmwareUpgradeEnabled,
 * transit, company, responsible, password, knock }. Секреты приходят открытым текстом и
 * наружу не выходят.
 */
function parameterChanges(before, after) {
  const fields = [];
  for (const field of PLAIN) {
    if (after[field] === undefined || same(before[field], after[field])) continue;
    fields.push({ field, from: before[field] ?? null, to: after[field] ?? null });
  }
  for (const field of [...REFS, ...SECRETS]) {
    if (after[field] === undefined || same(before[field], after[field])) continue;
    fields.push({ field });
  }
  const responsible =
    after.responsible !== undefined && !same(before.responsible, after.responsible)
      ? { from: before.responsible ? String(before.responsible) : null, to: after.responsible ? String(after.responsible) : null }
      : null;
  return { fields, responsible, any: fields.length > 0 || Boolean(responsible) };
}

module.exports = { parameterChanges };

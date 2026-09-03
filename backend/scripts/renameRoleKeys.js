// Переименование КЛЮЧЕЙ ролей. Из интерфейса это сделать нельзя намеренно:
// `member.role` хранит роль ключом, и переименование через штатный
// `update-role` оставило бы людей без прав молча. Здесь ключ меняется разом
// везде, где он живёт: в каталоге (`organizationRole.role`), в членстве
// (`member.role`, строка через запятую) и в `roles.catalogue.json`.
//
// Таблица ниже — единственное, что правят. Скрипт идемпотентен: пара, у
// которой старого ключа уже нет, а новый есть, пропускается.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/renameRoleKeys.js            # показать
//   node scripts/renameRoleKeys.js --apply    # записать
require("module-alias/register");
const fs = require("fs");
const mongoose = require("mongoose");

const { organizationId, invalidateRoles } = require("@/services/permissions");
const { CATALOGUE } = require("./syncRoleCatalogue");

/** старый ключ → новый. Ключ — латиница, цифры и дефис, 2–40 знаков. */
const RENAMES = {
  "client-company": "client-admin",
  engineer: "it-first-line",
  "engineer-lead": "it-second-line",
  "engineer-noworks": "contractor-no-works",
};

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

const splitRoles = (value) =>
  String(value || "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) throw new Error("Организации нет — переименовывать нечего");

  const catalogue = await db
    .collection("organizationRole")
    .find({ organizationId: orgId })
    .toArray();
  const existing = new Set(catalogue.map((row) => row.role));
  const members = await db
    .collection("member")
    .find({ organizationId: orgId }, { projection: { role: 1 } })
    .toArray();

  const pending = [];
  for (const [from, to] of Object.entries(RENAMES)) {
    if (!KEY_RE.test(to)) throw new Error(`Ключ «${to}» не по правилу ${KEY_RE}`);
    if (!existing.has(from)) {
      console.log(`  ${from} → ${to}: старого ключа нет${existing.has(to) ? ", новый уже есть — сделано" : ""}`);
      continue;
    }
    const source = catalogue.find((row) => row.role === from);
    const target = catalogue.find((row) => row.role === to);
    // Оба ключа сразу — либо чужая роль под новым ключом, либо прерванный
    // прогон (копия уже есть). Отличаем по содержимому.
    if (target && (target.title !== source.title || target.permission !== source.permission)) {
      throw new Error(`Ключ «${to}» уже занят другой ролью («${target.title}»)`);
    }
    const bearers = members.filter((row) => splitRoles(row.role).includes(from)).length;
    console.log(`  ${from} → ${to}  «${source.title}», членств: ${bearers}${target ? " (продолжение прерванного прогона)" : ""}`);
    pending.push({ from, to, bearers, source });
  }
  const targets = new Set(pending.map((item) => item.to));
  if (targets.size !== pending.length) throw new Error("Два старых ключа ведут в один новый");

  if (!apply || !pending.length) {
    console.log(pending.length ? "\nПоказ без записи. Повторите с --apply." : "\nМенять нечего.");
    await mongoose.disconnect();
    return;
  }

  // ПОРЯДОК — ЗАЩИТА ОТ ОБРЫВА без транзакций: сначала копия роли под новым
  // ключом, потом членство, и только потом удаление старого ключа. На любом
  // шаге оба ключа существуют, и ни один человек не остаётся со ссылкой на
  // несуществующую роль; повторный запуск доделывает прерванное.
  const map = new Map(pending.map((item) => [item.from, item.to]));
  for (const { to, source } of pending) {
    const { _id, ...copy } = source;
    await db
      .collection("organizationRole")
      .updateOne(
        { organizationId: orgId, role: to },
        { $setOnInsert: { ...copy, role: to, updatedAt: new Date() } },
        { upsert: true },
      );
  }
  let rewritten = 0;
  for (const row of members) {
    const roles = splitRoles(row.role);
    const next = roles.map((role) => map.get(role) || role);
    if (next.join(",") === roles.join(",")) continue;
    await db.collection("member").updateOne({ _id: row._id }, { $set: { role: next.join(",") } });
    rewritten += 1;
  }
  for (const { from } of pending) {
    await db.collection("organizationRole").deleteOne({ organizationId: orgId, role: from });
  }
  invalidateRoles();
  console.log(`\nКаталог: переименовано ${pending.length}. Членство: переписано ${rewritten}.`);

  // Файл — по тем же парам: иначе dumpRoleCatalogue потеряет matches/_note,
  // которые переносятся из прежней версии по ключу.
  if (fs.existsSync(CATALOGUE)) {
    const file = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));
    let touched = 0;
    for (const role of file.roles || []) {
      if (map.has(role.key)) {
        role.key = map.get(role.key);
        touched += 1;
      }
    }
    fs.writeFileSync(CATALOGUE, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`Файл каталога: ключей переписано ${touched}.`);
  }

  const leftovers = await db
    .collection("member")
    .countDocuments({
      organizationId: orgId,
      $or: pending.map(({ from }) => ({ role: { $regex: `(^|,)\\s*${from}\\s*(,|$)` } })),
    });
  console.log(`Членств со старыми ключами: ${leftovers} (ожидается 0)`);

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

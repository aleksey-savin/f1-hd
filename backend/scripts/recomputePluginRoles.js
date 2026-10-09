// Разовый пересчёт РОЛИ ПЛАГИНА в `users` (поле `role`), 2026-09-30 (спека
// docs/superpowers/specs/2026-09-30-security-hotfixes-w1-design.md, §1).
//
// Роль плагина теперь считается по набору прав, усечённому по адресату учётной
// записи (services/roles.js#pluginRole): клиентская учётная запись не бывает
// `impersonator`, какие бы роли у неё ни были. Сохранённые значения посчитаны
// по-старому. Скрипт пересчитывает роль всем, у кого есть членство в
// организации, той же формулой, что и правка ролей из интерфейса (`mirrorOf`).
//
// ПИШЕТ ТОЛЬКО `role`. `isAdmin` не трогается вовсе: это зеркало роли полного
// доступа, а признак полного доступа считается по каталогу, который может
// отставать от словаря, — пересчёт здесь погасил бы администраторов у всей
// установки (так и вышло бы с `mikrotik.upgradeFirmware`, см.
// grantUpgradeFirmware.js). `isAdmin` ведут назначение ролей и правка каталога.
//
// В выводе — только _id, адресат и было → станет: ни адресов, ни имён.
// Учётные записи без членства не трогаются: ролей у них нет, и приложение их
// зеркало не ведёт; строка с их числом — для сведения.
//
// Запись с проверкой: после --apply расхождения считаются заново по свежему
// чтению. Осталось хоть одно — прогон завершается кодом 1, и раннер не
// записывает миграцию в журнал (как в normalizePhones.js). Запускать при
// остановленном приложении: deploy.sh так и делает, когда есть ожидающие
// миграции.
//
// Идемпотентен: после записи расхождений нет, второй прогон ничего не меняет.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/recomputePluginRoles.js            # показать
//   node scripts/recomputePluginRoles.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { accountAudienceOf } = require("@/auth/access");
const { organizationId, listRoles } = require("@/services/permissions");
const { mirrorOf } = require("@/services/roles");

const roleKeys = (value) =>
  String(value || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

// Сверка базы с расчётом: у кого сохранённая роль плагина не равна расчётной.
// Зовётся дважды — до записи (это и есть показ) и после (проверка записи).
const compare = async (db, orgId) => {
  const catalogue = new Map(
    (await listRoles()).map((role) => [role.key, role.statements]),
  );
  const rows = await db
    .collection("member")
    .find({ organizationId: orgId }, { projection: { userId: 1, role: 1 } })
    .toArray();

  const ids = rows
    .map((row) => String(row.userId || ""))
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const accounts = new Map(
    (
      await db
        .collection("users")
        .find({ _id: { $in: ids } }, { projection: { isEndUser: 1, role: 1 } })
        .toArray()
    ).map((user) => [String(user._id), user]),
  );

  const changes = [];
  let orphans = 0;
  for (const row of rows) {
    const account = accounts.get(String(row.userId || ""));
    // Членство без учётной записи (или с битым userId) роли плагина не имеет
    if (!account) {
      orphans += 1;
      continue;
    }
    const { role } = mirrorOf(roleKeys(row.role), catalogue, account);
    if (account.role === role) continue;

    changes.push({
      id: String(account._id),
      audience: accountAudienceOf(account),
      from: account.role,
      to: role,
    });
  }

  const withoutMembership = await db
    .collection("users")
    .countDocuments({ _id: { $nin: ids } });

  return { members: rows.length, orphans, withoutMembership, changes };
};

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) throw new Error("Организации нет — пересчитывать нечего");

  const before = await compare(db, orgId);
  for (const { id, audience, from, to } of before.changes) {
    console.log(`  ${id} (${audience}): role ${from || "—"} → ${to}`);
  }
  console.log(
    `\nЧленств: ${before.members}, из них без учётной записи: ${before.orphans}. ` +
      `Учётных записей без членства (не трогаются): ${before.withoutMembership}. ` +
      `Расхождений: ${before.changes.length}.`,
  );

  if (!apply) {
    console.log(
      before.changes.length
        ? "Показ без записи. Повторите с --apply."
        : "Менять нечего.",
    );
    await mongoose.disconnect();
    return;
  }

  // Только `role`: `isAdmin` этим скриптом не пишется (см. шапку)
  for (const { id, to } of before.changes) {
    await db
      .collection("users")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { role: to } },
      );
  }

  const after = await compare(db, orgId);
  if (after.changes.length) {
    console.log("\nПосле записи не сошлись (роль в базе не равна расчётной):");
    for (const { id, audience, from, to } of after.changes) {
      console.log(`  ${id} (${audience}): role ${from || "—"}, ожидалась ${to}`);
    }
    console.log(
      "Прогон не завершён, код выхода 1: раннер не запишет миграцию в журнал. " +
        "Остановите приложение и повторите.",
    );
    process.exitCode = 1;
  } else {
    console.log(`Пересчитано учётных записей: ${before.changes.length}.`);
  }
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

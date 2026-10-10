// Разовая раздача права «Обновлять прошивку Mikrotik» (`mikrotik.upgradeFirmware`)
// ролям полного доступа, 2026-10-01.
//
// Коммит c762cfe (2026-09-29) завёл в словаре действие сотрудника
// `mikrotik.upgradeFirmware` и не раздал его ни одной роли. Роль администратора
// перестала быть ролью полного доступа (`isFullAccess` требует ВСЕ действия
// сотрудника), а по нему зеркалится `isAdmin`: первый же пересчёт зеркала —
// правка любой роли или `refreshMirrorFor` в grantConversations.js — гасит его у
// всех носителей. Каталог для новых установок (scripts/roles.catalogue.json)
// догнан отдельно; эта миграция — для уже живых ролей.
//
// Кому: ролям СОТРУДНИКОВ, которым не хватает ровно этого права до полного
// доступа (`needsUpgradeFirmwareGrant`, services/roles.js). ТОЛЬКО ДОПИСЫВАЕТ
// одно действие: наборы, правленные из интерфейса, не трогаем. Роль, которой не
// хватает ещё чего-то, и клиентские роли остаются как были. Поэтому в показе
// ДО grantConversations.js администратор не отмечен — ему не хватает ещё и
// `conversation.*`; в списке migrate.js эта миграция стоит после неё и до
// recomputePluginRoles.js: `isAdmin` возвращается как можно раньше.
//
// После записи зеркало пересчитывается тем же кодом, что и правка роли из
// интерфейса (`refreshMirrorFor`): `isAdmin` возвращается тем, у кого он погас.
// (`rolesToRefresh` общий с grantApproveChanges.js: он включает и роли, которым нужна любая из поздних раздач, поэтому в показе «=»/«+» могут стоять и роли, ждущие соседнюю миграцию.)
// Пересчёт — у носителей ВСЕХ ролей сотрудников с полным доступом, не только
// дополненных (`rolesToRefresh`): так повтор после обрыва возвращает `isAdmin`.
// Запускать при остановленном приложении: deploy.sh так и делает, когда есть
// ожидающие миграции.
//
// Идемпотентен: у роли, получившей право, оно уже есть, и второй прогон её не
// дополняет; пересчёт зеркала пишет те же значения.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/grantUpgradeFirmware.js            # показать
//   node scripts/grantUpgradeFirmware.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { organizationId, invalidateRoles } = require("@/services/permissions");
const {
  needsUpgradeFirmwareGrant,
  refreshMirrorFor,
  rolesToRefresh,
} = require("@/services/roles");

// Раздаваемое действие — так же его знают словарь (auth/access.js) и
// `needsUpgradeFirmwareGrant`
const RESOURCE = "mikrotik";
const ACTION = "upgradeFirmware";

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) throw new Error("Организации нет — раздавать некому");

  const rows = await db.collection("organizationRole").find({ organizationId: orgId }).toArray();

  const roles = [];
  for (const row of rows) {
    try {
      roles.push({
        row,
        key: row.role,
        audience: row.audience,
        statements: JSON.parse(row.permission || "{}") || {},
      });
    } catch {
      console.log(`  ${row.role}: permission не разбирается, пропуск`);
    }
  }

  // Зеркало пересчитывается у носителей ВСЕХ ролей сотрудников с полным доступом,
  // а не только у дополненных этим прогоном: оборвавшийся прогон при повторе
  // возвращает `isAdmin`. Адресат не записан — «сотрудникам», как везде
  // (`listRoles`): у старых ролей поля может и не быть
  const refresh = rolesToRefresh(roles);

  const changes = [];
  for (const { row, statements } of roles) {
    const refreshed = refresh.includes(row.role);
    // Право получают только те, у кого зеркало пересчитывается: дополненная
    // роль не может остаться без пересчёта
    const grant = refreshed && needsUpgradeFirmwareGrant(statements);
    // «+» — дополняется и пересчитывается; «=» — полный доступ уже есть, только пересчёт
    const mark = grant ? "+" : refreshed ? "=" : " ";
    console.log(`  ${mark} ${row.role} «${row.title || row.role}»${grant ? `: ${RESOURCE}.${ACTION}` : ""}`);
    if (!grant) continue;
    changes.push({
      row,
      permission: JSON.stringify({
        ...statements,
        [RESOURCE]: [...new Set([...(statements[RESOURCE] || []), ACTION])],
      }),
    });
  }

  const holders = refresh.length ? refresh.join(", ") : "—";
  if (!apply) {
    console.log(
      `\nПраво получат роли, отмеченные «+»: ${changes.length}. ` +
        `Зеркало (isAdmin, роль плагина) пересчитается у носителей ролей, отмеченных «+» и «=»: ${holders}.`,
    );
    console.log(
      changes.length || refresh.length
        ? "Показ без записи. Повторите с --apply."
        : "Менять нечего.",
    );
    await mongoose.disconnect();
    return;
  }

  for (const { row, permission } of changes) {
    await db
      .collection("organizationRole")
      .updateOne({ _id: row._id }, { $set: { permission, updatedAt: new Date() } });
  }
  invalidateRoles();
  for (const key of refresh) {
    await refreshMirrorFor(orgId, key);
  }

  console.log(`\nРолей дополнено: ${changes.length}. Зеркало пересчитано у носителей ролей: ${holders}.`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

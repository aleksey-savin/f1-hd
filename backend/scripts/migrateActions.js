// Переезд действий словаря (спека 2026-09-11) в живых ролях:
//   • переписывает `organizationRole.permission` по карте
//     services/actionMigration.js — идемпотентно;
//   • у клиентских ролей снимает действия адресата staff;
//   • носителям прежнего списка модераторов базы знаний
//     (preferences.knowledgeBase.moderators) дописывает роль `kb-moderator`,
//     если она уже есть в каталоге (syncRoleCatalogue.js --apply идёт ПЕРВЫМ).
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateActions.js            # показать
//   node scripts/migrateActions.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { organizationId, invalidateRoles } = require("@/services/permissions");
const { refreshMirrorFor, refreshMirrorForUsers } = require("@/services/roles");
const { migrateActions, flattenStatements } = require("@/services/actionMigration");
const { actionsToStatements, stripStatementsForAudience } = require("@/auth/access");

const KB_ROLE = "kb-moderator";

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
  if (!orgId) throw new Error("Организации нет — переезжать нечему");

  const rows = await db.collection("organizationRole").find({ organizationId: orgId }).toArray();
  const changes = [];
  for (const row of rows) {
    let stored = {};
    try {
      stored = JSON.parse(row.permission || "{}");
    } catch {
      console.log(`  ${row.role}: permission не разбирается, пропуск`);
      continue;
    }
    const before = flattenStatements(stored);
    let statements = actionsToStatements(migrateActions(before));
    if (row.audience === "client") {
      statements = stripStatementsForAudience(statements, "client");
    }
    const after = flattenStatements(statements);
    const added = after.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !after.includes(id));
    if (!added.length && !removed.length) continue;
    changes.push({ row, permission: JSON.stringify(statements) });
    console.log(`  ${row.role} «${row.title}»: +${added.join(", ") || "—"} | −${removed.join(", ") || "—"}`);
  }

  // Модераторы базы знаний из настроек → роль kb-moderator
  const prefs = await db.collection("preferences").findOne({}, { projection: { "knowledgeBase.moderators": 1 } });
  const moderatorIds = (prefs?.knowledgeBase?.moderators || [])
    .map((entry) => (entry?._id ? String(entry._id) : null))
    .filter(Boolean);
  const kbRoleExists = rows.some((row) => row.role === KB_ROLE);
  const memberships = [];
  if (moderatorIds.length) {
    const users = await db
      .collection("users")
      .find({ _id: { $in: moderatorIds.map((id) => new mongoose.Types.ObjectId(id)) } }, { projection: { email: 1 } })
      .toArray();
    console.log(`\nМодераторы из настроек (${users.length}): ${users.map((user) => user.email).join(", ")}`);
    if (!kbRoleExists) {
      console.log(`Роли ${KB_ROLE} в каталоге нет — сначала node scripts/syncRoleCatalogue.js --apply`);
    } else {
      const members = await db
        .collection("member")
        .find({ organizationId: orgId, userId: { $in: moderatorIds } }, { projection: { userId: 1, role: 1 } })
        .toArray();
      for (const member of members) {
        const roles = splitRoles(member.role);
        if (roles.includes(KB_ROLE)) continue;
        // `userId` носим с собой: по нему потом пересчитывается зеркало.
        memberships.push({
          _id: member._id,
          userId: String(member.userId),
          role: [...roles, KB_ROLE].join(","),
        });
      }
      console.log(`Членств к дописи: ${memberships.length}`);
    }
  }

  if (!apply) {
    console.log(changes.length || memberships.length ? "\nПоказ без записи. Повторите с --apply." : "\nМенять нечего.");
    await mongoose.disconnect();
    return;
  }

  for (const { row, permission } of changes) {
    await db.collection("organizationRole").updateOne({ _id: row._id }, { $set: { permission, updatedAt: new Date() } });
  }
  for (const { _id, role } of memberships) {
    await db.collection("member").updateOne({ _id }, { $set: { role } });
  }
  invalidateRoles();

  // Зеркало `isAdmin` обязано догнать переписанные роли и дописанные членства:
  // роль, потерявшая полный доступ, иначе оставит носителей администраторами, а
  // дополненная до него — не сделает ими вовсе. Логика одна и та же, что у
  // интерфейса ролей (services/roles.js), второй копии здесь нет.
  for (const { row } of changes) {
    await refreshMirrorFor(orgId, row.role);
  }
  await refreshMirrorForUsers(
    orgId,
    memberships.map(({ userId }) => userId),
  );

  console.log(`\nРолей переписано: ${changes.length}. Членств дописано: ${memberships.length}.`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

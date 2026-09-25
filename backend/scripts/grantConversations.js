// Разовая раздача прав «Диалогов» (`conversation.*`) живым ролям, 2026-09-25.
//
// Кто что получает — `conversationGrants` (services/actionMigration.js):
// берущие заявки — читать и отвечать, ведущие заявки — ещё и вести; сторонний
// исполнитель и клиентские роли — ничего.
//
// ТОЛЬКО ДОПИСЫВАЕТ: наборы ролей, правленные из интерфейса, не трогаем. Без
// раздачи роль администратора отстала бы от словаря, перестала считаться полным
// доступом (`isFullAccess`), и зеркало `isAdmin` погасло бы у всех
// администраторов при первой же правке ролей.
//
// Идемпотентен. Запуск внутри контейнера бэкенда:
//   node scripts/grantConversations.js            # показать
//   node scripts/grantConversations.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { organizationId, invalidateRoles } = require("@/services/permissions");
const { refreshMirrorFor } = require("@/services/roles");
const { conversationGrants, flattenStatements } = require("@/services/actionMigration");

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) throw new Error("Организации нет — раздавать некому");

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
    const grants = conversationGrants({
      key: row.role,
      audience: row.audience,
      actions: flattenStatements(stored),
    });
    console.log(`  ${grants.length ? "+" : " "} ${row.role} «${row.title || row.role}»${grants.length ? `: ${grants.join(", ")}` : ""}`);
    if (!grants.length) continue;
    const next = { ...stored };
    for (const id of grants) {
      const [resource, action] = id.split(".");
      next[resource] = [...new Set([...(next[resource] || []), action])];
    }
    changes.push({ row, permission: JSON.stringify(next) });
  }

  if (!apply) {
    console.log(
      changes.length
        ? `\nПоказ без записи: права получат роли, отмеченные «+» (${changes.length}). Повторите с --apply.`
        : "\nМенять нечего.",
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
  for (const { row } of changes) {
    await refreshMirrorFor(orgId, row.role);
  }

  console.log(`\nРолей дополнено: ${changes.length}.`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

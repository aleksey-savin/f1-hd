// Разовая раздача права «Пользоваться функциями ИИ» (`ai.use`) живым ролям.
//
// Право появилось 2026-09-21: до него функции ИИ в карточке заявки шли довеском
// к «Брать заявки в работу», и их получал сторонний исполнитель. Переезд ничего
// не отнимает у своих: роль сотрудника, которая берёт заявки, право получает —
// кроме ролей стороннего исполнителя. Правило — `receivesAiUse`
// (services/actionMigration.js), там же и объяснение, почему оно не в DERIVED.
//
// ТОЛЬКО ДОПИСЫВАЕТ одно действие: наборы ролей, правленные из интерфейса,
// остаются как есть (в отличие от syncRoleCatalogue, который переписывает роль
// целиком). Без раздачи роль администратора отстала бы от словаря, перестала
// считаться полным доступом (`isFullAccess`), и зеркало `isAdmin` погасло бы у
// всех администраторов при первой же правке ролей.
//
// Идемпотентен. Запуск внутри контейнера бэкенда:
//   node scripts/grantAiUse.js            # показать
//   node scripts/grantAiUse.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { organizationId, invalidateRoles } = require("@/services/permissions");
const { refreshMirrorFor } = require("@/services/roles");
const {
  AI_USE,
  receivesAiUse,
  flattenStatements,
} = require("@/services/actionMigration");

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) throw new Error("Организации нет — раздавать некому");

  const rows = await db
    .collection("organizationRole")
    .find({ organizationId: orgId })
    .toArray();

  const changes = [];
  for (const row of rows) {
    let stored = {};
    try {
      stored = JSON.parse(row.permission || "{}");
    } catch {
      console.log(`  ${row.role}: permission не разбирается, пропуск`);
      continue;
    }
    const actions = flattenStatements(stored);
    const gets = receivesAiUse({
      key: row.role,
      audience: row.audience,
      actions,
    });
    console.log(
      `  ${gets ? "+" : " "} ${row.role} «${row.title || row.role}»${
        actions.includes(AI_USE) ? " — уже есть" : ""
      }`,
    );
    if (!gets) continue;
    // Дописываем в набор как он есть: остальное в роли не трогаем вовсе
    const [resource, action] = AI_USE.split(".");
    changes.push({
      row,
      permission: JSON.stringify({
        ...stored,
        [resource]: [...new Set([...(stored[resource] || []), action])],
      }),
    });
  }

  if (!apply) {
    console.log(
      changes.length
        ? `\nПоказ без записи: право получат роли, отмеченные «+» (${changes.length}). Повторите с --apply.`
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

  // Роль администратора снова отдаёт весь словарь — зеркало `isAdmin` у её
  // носителей обязано это увидеть (та же логика, что у интерфейса ролей)
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

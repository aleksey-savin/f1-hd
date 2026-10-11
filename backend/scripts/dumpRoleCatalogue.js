// Обратная выгрузка: КАТАЛОГ РОЛЕЙ ИЗ БАЗЫ → roles.catalogue.json.
//
// Роли заводят и правят в интерфейсе, а в поставку едет ФАЙЛ. Выгружаются ключ,
// название, описание, адресат и набор действий. Людей и прочих данных раздачи
// выгрузка не пишет: файл — каталог продукта, а не слепок одной установки.
// Выгрузку собственной установки держат вне репозитория.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/dumpRoleCatalogue.js            # показать, что изменится
//   node scripts/dumpRoleCatalogue.js --apply    # переписать файл
require("module-alias/register");
const fs = require("fs");
const mongoose = require("mongoose");

const {
  statementsToActions,
  actionsToStatements,
  isFullAccess,
  STAFF_ACTIONS,
} = require("@/auth/access");
const { listRoles, organizationId } = require("@/services/permissions");
const { CATALOGUE } = require("./syncRoleCatalogue");

const HEADER = [
  "Каталог ролей поставки: ДАННЫЕ, а не код. По нему первый запуск заводит роли",
  "(services/bootstrapSeed.js), а scripts/syncRoleCatalogue.js --apply догоняет",
  "каталог существующей базы. Людей и следов конкретной установки здесь нет.",
  "",
  "`key` — НЕИЗМЕНЯЕМЫЙ ключ роли. Именно его хранит `member.role`, поэтому",
  "менять его нельзя: переименование ключа оставит людей без прав молча.",
  "`title` — то, что видит человек; правится свободно, в том числе из UI.",
  "",
  "`actions` — действия СЛОВАРЯ (backend/auth/access.js), «ресурс.действие».",
  "",
  "Роль полного доступа ОБЯЗАНА содержать все действия СОТРУДНИКА (адресат",
  "staff или both): по признаку «роль отдаёт всё» зеркалится user.isAdmin",
  "(auth/access.js#isFullAccess). Клиентские действия в счёт не идут — у",
  "сотрудника они не действуют. Новое действие в словаре — пересобрать файл,",
  "иначе зеркало погаснет у всех администраторов.",
];

const buildCatalogue = async (previous) => {
  const prevOrder = new Map(
    (previous?.roles || []).map((role, index) => [role.key, index]),
  );

  const roles = [];
  for (const role of await listRoles()) {
    const entry = {
      key: role.key,
      title: role.title,
      audience: role.audience,
      description: role.description,
      actions: statementsToActions(role.statements),
    };
    roles.push(entry);
  }

  /**
   * Роль полного доступа обязана совпадать с набором сотрудника ДОСЛОВНО.
   *
   * Иначе выгрузка тихо возвращает файл к состоянию базы, которая отстала от
   * словаря: `isFullAccess` узнаёт роль и по набору с лишним клиентским
   * действием, так что дамп с непрогнанными миграциями вернул бы в каталог
   * `approval.decide` у администратора — и разъехался бы с кодом.
   */
  for (const role of roles) {
    if (!isFullAccess(actionsToStatements(role.actions))) continue;
    const extra = role.actions.filter((id) => !STAFF_ACTIONS.includes(id));
    if (extra.length) {
      throw new Error(
        `Роль «${role.key}» отдаёт полный доступ, но несёт лишнее: ${extra.join(", ")}. ` +
          "База отстала от словаря — сначала node scripts/syncRoleCatalogue.js --apply, " +
          "потом выгрузка.",
      );
    }
  }

  // Порядок прежнего файла, новые роли — в конец: диффы должны читаться.
  roles.sort((a, b) => {
    const ia = prevOrder.has(a.key) ? prevOrder.get(a.key) : Number.MAX_SAFE_INTEGER;
    const ib = prevOrder.has(b.key) ? prevOrder.get(b.key) : Number.MAX_SAFE_INTEGER;
    return ia - ib || a.key.localeCompare(b.key);
  });

  return { _: HEADER, roles };
};

const describeChanges = (previous, next) => {
  const prev = new Map((previous?.roles || []).map((role) => [role.key, role]));
  const lines = [];
  for (const role of next.roles) {
    const before = prev.get(role.key);
    if (!before) {
      lines.push(`  + ${role.key} «${role.title}» — новая роль`);
      continue;
    }
    const diff = [];
    if (before.title !== role.title) diff.push(`название «${before.title}» → «${role.title}»`);
    if ((before.description || "") !== (role.description || "")) diff.push("описание");
    if ((before.audience || "staff") !== role.audience) diff.push(`адресат ${before.audience || "staff"} → ${role.audience}`);
    const was = new Set(before.actions || []);
    const now = new Set(role.actions || []);
    const added = [...now].filter((id) => !was.has(id));
    const removed = [...was].filter((id) => !now.has(id));
    if (added.length) diff.push(`+${added.length} действ.`);
    if (removed.length) diff.push(`−${removed.length} действ.`);
    if (diff.length) lines.push(`  ~ ${role.key}: ${diff.join("; ")}`);
  }
  for (const key of prev.keys()) {
    if (!next.roles.some((role) => role.key === key)) {
      lines.push(`  − ${key} «${prev.get(key).title}» — удалена`);
    }
  }
  return lines;
};

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const orgId = await organizationId();
  if (!orgId) {
    throw new Error("Организации нет — выгружать нечего");
  }

  const previous = fs.existsSync(CATALOGUE)
    ? JSON.parse(fs.readFileSync(CATALOGUE, "utf8"))
    : null;
  const next = await buildCatalogue(previous);

  console.log(`Ролей в базе: ${next.roles.length}`);
  for (const role of next.roles) {
    console.log(
      `  ${role.key.padEnd(18)} «${role.title}» [${role.audience}] ` +
        `${role.actions.length} действ.`,
    );
  }

  const changes = describeChanges(previous, next);
  console.log(`\nОтличия от файла:${changes.length ? "" : " нет"}`);
  changes.forEach((line) => console.log(line));

  if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
  } else {
    // Пишем поверх существующего файла: он смонтирован с хоста, и новый инод
    // достался бы root'у контейнера.
    fs.writeFileSync(CATALOGUE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nЗаписано: ${CATALOGUE}`);
  }

  await mongoose.disconnect();
};

module.exports = { buildCatalogue, describeChanges };

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

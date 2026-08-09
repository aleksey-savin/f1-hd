// Одна организация на всю установку + членство для всех пользователей.
//
// Организация здесь — не компания-клиент, а сама инсталляция: плагин
// `organization` хранит роли в разрезе организации, и другого способа получить
// глобальные роли нет. `Company` остаётся обычной моделью приложения и плагина
// не касается — у неё домены для разбора почты, тарифы, подразделения.
//
// Роли скрипт НЕ назначает: `member.role` остаётся пустым, поэтому эффективные
// права после миграции совпадают с доролевыми побайтово. Роли раздаёт
// `assignRoles.js` отдельным шагом, когда каталог назван человеком.
//
// Идемпотентен: повторный запуск дозаводит недостающее членство и ничего не
// перезаписывает.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateOrganization.js            # только показать
//   node scripts/migrateOrganization.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { ORG_SLUG } = require("@/services/permissions");

const ORG_NAME = process.env.BOOTSTRAP_ORG_NAME || "Helpdesk";

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  const users = await db
    .collection("users")
    // Служебным учёткам сессии не выдаются никогда — членство им ни к чему.
    .find({ isServiceAccount: { $ne: true } }, { projection: { _id: 1 } })
    .toArray();

  let org = await db.collection("organization").findOne({ slug: ORG_SLUG });
  const existingMembers = org
    ? await db
        .collection("member")
        .countDocuments({ organizationId: String(org._id) })
    : 0;

  console.log(`Организация «${ORG_SLUG}»: ${org ? "есть" : "НЕТ, будет создана"}`);
  console.log(`Пользователей (без служебных): ${users.length}`);
  console.log(`Членство уже есть у:           ${existingMembers}`);
  console.log(`Будет заведено:                ${users.length - existingMembers}`);

  if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  if (!org) {
    const result = await db.collection("organization").insertOne({
      name: ORG_NAME,
      slug: ORG_SLUG,
      createdAt: new Date(),
      metadata: null,
    });
    org = { _id: result.insertedId };
    console.log(`\nОрганизация создана: ${org._id}`);
  }

  const orgId = String(org._id);
  const already = new Set(
    (
      await db
        .collection("member")
        .find({ organizationId: orgId }, { projection: { userId: 1 } })
        .toArray()
    ).map((member) => String(member.userId)),
  );

  // Членство удалённого пользователя — мусор, который потом мешает считать
  // «сколько человек без роли»: сходится всё, кроме одной строки без хозяина.
  const alive = new Set(users.map((user) => String(user._id)));
  const orphans = [...already].filter((id) => !alive.has(id));
  if (orphans.length) {
    await db.collection("member").deleteMany({
      organizationId: orgId,
      userId: { $in: orphans },
    });
    console.log(`Осиротевшее членство убрано: ${orphans.length}`);
    orphans.forEach((id) => already.delete(id));
  }

  const rows = users
    .filter((user) => !already.has(String(user._id)))
    .map((user) => ({
      organizationId: orgId,
      userId: String(user._id),
      // Пусто = прав ролью не даётся. Ровно то, что нужно на этом шаге.
      role: "",
      createdAt: new Date(),
    }));

  if (rows.length) {
    await db.collection("member").insertMany(rows);
  }
  console.log(`Членство заведено: ${rows.length}`);

  // Индексы адаптер не создаёт сам — а членство читается на каждый запрос.
  await db
    .collection("member")
    .createIndex({ organizationId: 1, userId: 1 }, { unique: true });
  await db.collection("member").createIndex({ organizationId: 1, role: 1 });
  await db
    .collection("organizationRole")
    .createIndex({ organizationId: 1, role: 1 }, { unique: true });
  await db.collection("organization").createIndex({ slug: 1 }, { unique: true });
  console.log("Индексы созданы");

  const total = await db
    .collection("member")
    .countDocuments({ organizationId: orgId });
  console.log(`\nВсего членов: ${total} (ожидается ${users.length})`);
  if (total !== users.length) {
    throw new Error("Членство неполное — разберитесь вручную.");
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

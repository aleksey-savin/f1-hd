// Разведка перед нормализацией почты (переезд на better-auth, 2026-08).
//
// Схема users.email объявлена unique, но до этого переезда была БЕЗ lowercase,
// а controllers/user.js#add искал дубль по сырому значению — значит
// «Ivanov@f1lab.ru» и «ivanov@f1lab.ru» могли завестись оба. better-auth
// приводит адрес к нижнему регистру: из такой пары один перестанет входить, а
// второй начнёт входить под чужим паролем. Разруливать это должен человек,
// поэтому скрипт НИЧЕГО НЕ ПИШЕТ — только показывает.
//
// Гоняется дважды: на дев-копии при подготовке и на проде непосредственно
// перед normalizeUserEmails.js.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/checkEmailCollisions.js
require("module-alias/register");
const mongoose = require("mongoose");

const normalize = (email) => String(email || "").trim().toLowerCase();

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const users = mongoose.connection.db.collection("users");
  const tickets = mongoose.connection.db.collection("tickets");
  const total = await users.countDocuments();

  // 1. Коллизии — единственное, что блокирует нормализацию
  const collisions = await users
    .aggregate([
      {
        $group: {
          _id: { $toLower: { $trim: { input: "$email" } } },
          count: { $sum: 1 },
          ids: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  console.log(`Пользователей всего: ${total}`);
  console.log(`\n1. Коллизии после приведения к нижнему регистру: ${collisions.length}`);

  for (const group of collisions) {
    console.log(`\n  ${group._id} — ${group.count} учётки:`);
    for (const id of group.ids) {
      const user = await users.findOne({ _id: id });
      // Число заявок — главный аргумент при выборе «кого оставить»: учётку с
      // историей сливать некуда, у неё ссылки в 31 коллекции.
      const ticketCount = await tickets.countDocuments({
        $or: [{ applicantId: id }, { "applicant._id": id }],
      });
      console.log(
        `    ${String(id)} | ${JSON.stringify(user.email)} | ` +
          `${user.lastName || ""} ${user.firstName || ""}`.trim() +
          ` | компания: ${user.company?.alias || "—"}` +
          ` | отключена: ${user.banned ? "да" : "нет"}` +
          ` | админ: ${Boolean(user.isAdmin)}` +
          ` | клиент: ${user.isEndUser !== false}` +
          ` | вход: ${user.lastLogin ? new Date(user.lastLogin).toISOString().slice(0, 10) : "никогда"}` +
          ` | заявок: ${ticketCount}`,
      );
    }
  }

  // 2. Требующие нормализации — они не блокируют, их просто починит апдейт
  const dirty = await users
    .find({ $expr: { $ne: ["$email", { $toLower: { $trim: { input: "$email" } } }] } })
    .project({ email: 1 })
    .toArray();
  console.log(`\n2. Адресов не в каноничной форме: ${dirty.length}`);
  dirty.slice(0, 20).forEach((u) => console.log(`    ${JSON.stringify(u.email)}`));
  if (dirty.length > 20) console.log(`    …и ещё ${dirty.length - 20}`);

  // 3. Битые адреса — их нормализация не спасёт, нужен человек
  const broken = await users
    .find({
      $or: [
        { email: { $exists: false } },
        { email: null },
        { email: "" },
        { email: { $not: /@/ } },
        { email: /\s/ },
      ],
    })
    .project({ email: 1, firstName: 1, lastName: 1, banned: 1 })
    .toArray();
  console.log(`\n3. Адресов без @, пустых или с пробелами внутри: ${broken.length}`);
  broken.forEach((u) =>
    console.log(`    ${String(u._id)} | ${JSON.stringify(u.email)} | отключена: ${u.banned ? "да" : "нет"}`),
  );

  // 4. Дубли AD-идентификатора: индекс unique+sparse пропускает пустые СТРОКИ
  // (sparse отсеивает только отсутствие поля и null), так что второй документ
  // с "" индекс отвергнет — и это всплывёт при первом же save() чужой правки.
  const adDupes = await users
    .aggregate([
      { $match: { activeDirectoryObjectGUID: { $exists: true, $ne: null } } },
      { $group: { _id: "$activeDirectoryObjectGUID", count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  console.log(`\n4. Дублей activeDirectoryObjectGUID: ${adDupes.length}`);
  adDupes.forEach((g) =>
    console.log(`    ${JSON.stringify(g._id)} — ${g.count}: ${g.ids.map(String).join(", ")}`),
  );

  console.log(
    collisions.length
      ? `\nНОРМАЛИЗАЦИЯ ЗАБЛОКИРОВАНА: разберите ${collisions.length} коллизий вручную.`
      : "\nКоллизий нет — normalizeUserEmails.js можно запускать.",
  );

  await mongoose.disconnect();
  process.exitCode = collisions.length ? 1 : 0;
};

run().catch((error) => {
  console.error("Не удалось проверить адреса:", error);
  process.exit(1);
});

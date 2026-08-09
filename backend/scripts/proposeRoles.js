// ТОЛЬКО ЧТЕНИЕ. Группирует людей по подписи прав и печатает готовый каталог
// ролей — заготовку для `assignRoles.js`.
//
// Смысл в том, что роли не выдумываются, а вычитываются из того, как система
// используется на самом деле: 702 учётки укладываются примерно в два десятка
// наборов, и подавляющее большинство — в четыре. Имена ролей скрипт придумать
// не может, поэтому печатает заглушки `role1`, `role2` — их правит человек.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/proposeRoles.js
//   node scripts/proposeRoles.js --json > /tmp/roles.json
require("module-alias/register");
const mongoose = require("mongoose");

const { PERMISSION_KEYS } = require("@/utils/permissions");
const { permissionsToStatements } = require("@/auth/access");

const run = async () => {
  const asJson = process.argv.includes("--json");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const users = mongoose.connection.db.collection("users");

  const docs = await users
    .find(
      {},
      {
        projection: {
          permissions: 1,
          isAdmin: 1,
          isEndUser: 1,
          isServiceAccount: 1,
          firstName: 1,
          lastName: 1,
          email: 1,
        },
      },
    )
    .toArray();

  // Подпись набора — отсортированный список включённых прав. Служебные учётки
  // считаем отдельно: сессий им не выдают, роль им не нужна.
  const groups = new Map();
  const service = [];

  for (const user of docs) {
    if (user.isServiceAccount) {
      service.push(user);
      continue;
    }
    const granted = PERMISSION_KEYS.filter((key) => user.permissions?.[key]);
    const signature = granted.join(",") || "(нет прав)";
    const key = `${user.isAdmin ? "admin|" : ""}${signature}`;

    if (!groups.has(key)) {
      groups.set(key, { granted, isAdmin: Boolean(user.isAdmin), users: [] });
    }
    groups.get(key).users.push(user);
  }

  const sorted = [...groups.entries()].sort(
    (a, b) => b[1].users.length - a[1].users.length,
  );

  const proposal = sorted.map(([, group], index) => ({
    name: `role${index + 1}`,
    isAdmin: group.isAdmin,
    people: group.users.length,
    permissions: group.granted,
    statements: permissionsToStatements(
      Object.fromEntries(group.granted.map((key) => [key, true])),
    ),
    sample: group.users
      .slice(0, 3)
      .map((user) => `${user.lastName || ""} ${user.firstName || ""}`.trim() || user.email),
  }));

  if (asJson) {
    console.log(JSON.stringify({ roles: proposal }, null, 2));
    await mongoose.disconnect();
    return;
  }

  console.log(`Всего учётных записей: ${docs.length}`);
  console.log(`Служебных (роль не нужна): ${service.length}`);
  console.log(`Уникальных наборов прав: ${proposal.length}\n`);

  for (const role of proposal) {
    console.log(
      `${role.name}  — ${role.people} чел.${role.isAdmin ? "  [администраторы]" : ""}`,
    );
    console.log(
      `  права: ${role.permissions.length ? role.permissions.join(", ") : "нет"}`,
    );
    console.log(`  например: ${role.sample.join("; ")}`);
    console.log();
  }

  console.log(
    "Дальше: назвать роли по-человечески и передать список в assignRoles.js.\n" +
      "Наборы из одного человека — кандидаты на объединение: решает человек, не скрипт.",
  );

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

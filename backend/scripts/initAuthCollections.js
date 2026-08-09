// Индексы для коллекций better-auth (переезд на better-auth, 2026-08).
//
// Адаптер их НЕ СОЗДАЁТ. Критично два:
//   • authSessions.token читается на КАЖДОМ запросе — без уникального индекса
//     это скан коллекции, растущий вместе с числом сеансов;
//   • TTL на expiresAt — единственная уборка протухших сессий и верификаций,
//     своего крона у better-auth нет.
//
// Идемпотентен: createIndex по существующему имени с теми же параметрами —
// пустая операция.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/initAuthCollections.js
require("module-alias/register");
const mongoose = require("mongoose");

const INDEXES = [
  ["authSessions", { token: 1 }, { unique: true, name: "token_uniq" }],
  ["authSessions", { userId: 1 }, { name: "userId" }],
  ["authSessions", { expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl" }],
  ["authAccounts", { userId: 1 }, { name: "userId" }],
  [
    "authAccounts",
    { providerId: 1, accountId: 1 },
    { unique: true, name: "provider_uniq" },
  ],
  ["authVerifications", { identifier: 1 }, { name: "identifier" }],
  [
    "authVerifications",
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: "ttl" },
  ],
];

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  for (const [collection, keys, options] of INDEXES) {
    const created = await db.collection(collection).createIndex(keys, options);
    console.log(`  ${collection}: ${created}`);
  }

  console.log("\nИтог:");
  for (const collection of ["authSessions", "authAccounts", "authVerifications"]) {
    const names = (await db.collection(collection).indexes()).map((index) => index.name);
    console.log(`  ${collection}: ${names.join(", ")}`);
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Не удалось создать индексы:", error);
  process.exit(1);
});

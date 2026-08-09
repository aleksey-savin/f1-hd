// Перевод API-ключей компаний на хранение ОТПЕЧАТКА.
//
// Ключи лежали в базе строкой: любая выгрузка, бэкап или доступ к mongo давали
// готовое значение, которым можно заводить заявки от имени компании.
//
// РОТАЦИЯ НЕ НУЖНА. Значение у нас пока есть, поэтому отпечаток и хвост
// считаются на месте, а интеграции продолжают ходить с теми же ключами и
// ничего не замечают. Само значение остаётся до `eraseApiKeyValues.js` — пока
// оно рядом, откат стоит одну строку.
//
//   node scripts/migrateApiKeyHashes.js            # только показать
//   node scripts/migrateApiKeyHashes.js --apply
require("module-alias/register");
const mongoose = require("mongoose");

const { hashApiKey, apiKeyTail } = require("@/utils/apiKeyGenerator");

const APPLY = process.argv.includes("--apply");

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const companies = mongoose.connection.db.collection("companies");

  const rows = await companies
    .find({ "apiKeys.0": { $exists: true } })
    .project({ alias: 1, apiKeys: 1 })
    .toArray();

  let total = 0;
  let ready = 0;
  let orphan = 0;

  for (const company of rows) {
    for (const key of company.apiKeys) {
      total += 1;
      if (key.keyHash) {
        ready += 1;
        continue;
      }
      if (!key.key) {
        // Ни значения, ни отпечатка — таким ключом войти нельзя в принципе.
        orphan += 1;
        console.log(`  ! ${company.alias} / ${key.name}: нечего хешировать`);
        continue;
      }
      console.log(
        `  ${company.alias} / ${key.name}: …${apiKeyTail(key.key)}`,
      );
      if (APPLY) {
        await companies.updateOne(
          { _id: company._id, "apiKeys._id": key._id },
          {
            $set: {
              "apiKeys.$.keyHash": hashApiKey(key.key),
              "apiKeys.$.keyTail": apiKeyTail(key.key),
            },
          },
        );
      }
    }
  }

  console.log(
    `\nВсего ключей: ${total}. Уже с отпечатком: ${ready}. Без значения: ${orphan}.`,
  );
  console.log(
    APPLY
      ? "Отпечатки проставлены. Значения НЕ удалены — это делает eraseApiKeyValues.js."
      : "Без --apply ничего не записано",
  );

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

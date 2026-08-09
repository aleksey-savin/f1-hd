// Удаление значений API-ключей — ТОЧКА НЕВОЗВРАТА.
//
// После него посмотреть выданный ключ не сможет никто, включая администратора:
// в базе останется только отпечаток. Ради этого всё и затевалось — выгрузка
// базы перестаёт давать рабочий доступ.
//
// СКРИПТ ЖДЁТ ДОКАЗАТЕЛЬСТВА, А НЕ КАЛЕНДАРЯ.
//
// Ошибиться в переводе поиска на отпечаток легко и незаметно: лишний пробел,
// регистр, кодировка — совпадения нет. Ходят по этим ключам машины, они не
// позвонят: заявки просто перестанут создаваться. Пока значение лежит рядом,
// откат стоит одну строку; после удаления откатывать нечем.
//
// Признак «этот ключ прошёл по новому пути» — отметка `lastUsedAt`, выставленная
// ПОСЛЕ перевода поиска. Дата перевода передаётся аргументом:
//
//   node scripts/eraseApiKeyValues.js --since 2026-08-10T12:00:00Z
//   node scripts/eraseApiKeyValues.js --since 2026-08-10T12:00:00Z --apply
//
// Неактивные ключи доказывать нечем и незачем — ими всё равно не войти.
require("module-alias/register");
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const sinceArg = process.argv[process.argv.indexOf("--since") + 1];

const run = async () => {
  const since = sinceArg ? new Date(sinceArg) : null;
  if (!since || Number.isNaN(since.getTime())) {
    throw new Error(
      "Укажите --since <дата перевода поиска на отпечаток>, например --since 2026-08-10T12:00:00Z",
    );
  }

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const companies = mongoose.connection.db.collection("companies");

  const rows = await companies
    .find({ "apiKeys.0": { $exists: true } })
    .project({ alias: 1, apiKeys: 1 })
    .toArray();

  const waiting = [];
  const noHash = [];
  let erasable = 0;
  let already = 0;

  for (const company of rows) {
    for (const key of company.apiKeys) {
      const where = `${company.alias} / ${key.name}`;

      if (!key.keyHash) {
        noHash.push(where);
        continue;
      }
      if (key.key === undefined) {
        already += 1;
        continue;
      }
      if (!key.isActive) {
        // Отключённым ключом войти нельзя — доказывать нечего.
        erasable += 1;
        continue;
      }

      const provenAt = key.lastUsedAt ? new Date(key.lastUsedAt) : null;
      if (provenAt && provenAt >= since) {
        erasable += 1;
      } else {
        waiting.push(
          `${where} — ${provenAt ? `работал ${provenAt.toISOString()}, до перевода` : "не работал ни разу"}`,
        );
      }
    }
  }

  console.log(`Значение уже удалено: ${already}`);
  console.log(`Готовы к удалению: ${erasable}`);

  if (noHash.length) {
    throw new Error(
      "Есть ключи без отпечатка — сначала migrateApiKeyHashes.js --apply:\n  " +
        noHash.join("\n  "),
    );
  }

  if (waiting.length) {
    console.log(`\nЖдём доказательства у ${waiting.length}:`);
    for (const line of waiting) console.log(`  ${line}`);
    throw new Error(
      "Не все живые ключи прошли по новому поиску. Удалять значения рано: " +
        "откат ещё может понадобиться.",
    );
  }

  if (!APPLY) {
    console.log("\nВсе живые ключи доказаны. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  const result = await companies.updateMany(
    { "apiKeys.0": { $exists: true } },
    { $unset: { "apiKeys.$[].key": "" } },
  );
  console.log(`\nЗначения удалены. Изменено компаний: ${result.modifiedCount}`);

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

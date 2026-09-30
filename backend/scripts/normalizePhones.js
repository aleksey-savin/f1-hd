// Разовое приведение сохранённых телефонов к канону «только цифры с кодом
// страны», 2026-09-30 (спека docs/superpowers/specs/2026-09-30-phone-normalization-design.md).
//
// Обходит все поля телефонов, включая снимки людей в компаниях, заявках и
// регламентах (services/phoneMigration.js). Ни номера, ни слова из свободного
// текста в отчёт не попадают — только _id, путь и форма значения
// («+9 (999) 999-99-99»: цифры — 9, буквы — a). Запускать при остановленном
// приложении: deploy.sh так и делает, когда есть ожидающие миграции.
//
// Запись идёт с проверкой: обновление находит документ по _id И по прочитанным
// значениям. Снимки пишутся по позиции (responsibles.2.phone) и не должны попасть
// в другой элемент, если массив успели изменить между чтением и записью. Не
// совпавшее перечисляется, прогон завершается кодом 1, и раннер не записывает
// миграцию в журнал.
//
// Идемпотентен для известных форм (+7, след старой маски «+8 (…)», неполный
// «+7 …»): повторный прогон ничего не меняет. Журнал migrate.js записывает
// миграцию только после кода 0, так что после успеха скрипт не повторяется. А
// любой повторный --apply (после сбоя или вручную) прочёл бы уже записанный номер
// другой страны из 10 цифр или с ведущей 8 как российский, и показ перед повтором
// его уже не выделит — он посчитает его обычной правкой. Перед повтором смотрите
// список «foreign» из вывода первого прогона (годный номер другой страны, пишется
// как дан; в копии прода 2026-09-30 их нет). «plus8» — «+8 (…)», прочитанный как
// российский.
// Негодное («invalid») остаётся цифрами — его правят руками.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/normalizePhones.js            # показать
//   node scripts/normalizePhones.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { PHONE_PATHS, planDocument, projectionFor } = require("@/services/phoneMigration");

const BATCH = 1000;
// Что перечислять поимённо: это правят руками или проверяют глазами
const LISTED = new Set(["invalid", "split", "plus8", "foreign"]);

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  const totals = new Map();
  const listed = [];
  let documents = 0; // сколько документов нужно изменить
  let matched = 0; // сколько обновлений нашли документ в прочитанном виде
  let modified = 0;
  const missed = []; // обновления, которые не совпали с прочитанным

  for (const spec of PHONE_PATHS) {
    const collection = db.collection(spec.collection);
    let batch = [];
    const flush = async () => {
      if (apply && batch.length) {
        const result = await collection.bulkWrite(
          batch.map(({ id, set, expect }) => ({
            updateOne: { filter: { _id: id, ...expect }, update: { $set: set } },
          })),
          { ordered: false },
        );
        matched += result.matchedCount;
        modified += result.modifiedCount;
        if (result.matchedCount < batch.length) {
          // При ordered:false результат не называет несовпавшие операции. Они не
          // записаны, значит, нового значения в документе нет
          for (const { id, set } of batch) {
            if (!(await collection.countDocuments({ _id: id, ...set }, { limit: 1 }))) {
              missed.push(`  ${spec.collection} ${id}`);
            }
          }
        }
      }
      batch = [];
    };

    for await (const doc of collection.find({}, { projection: projectionFor(spec) })) {
      const { set, expect, findings } = planDocument(spec, doc);
      for (const finding of findings) {
        // «responsibles.3.phone» → «responsibles[].phone»: итог по полю, не по позиции
        const field = finding.path.replace(/\.\d+(?=\.|$)/g, "[]");
        const key = `${spec.collection}.${field} ${finding.status}`;
        totals.set(key, (totals.get(key) || 0) + 1);
        if (LISTED.has(finding.status)) {
          listed.push(`  ${finding.status.padEnd(7)} ${spec.collection} ${doc._id} ${finding.path} «${finding.shape}»`);
        }
      }
      if (Object.keys(set).length) {
        documents += 1;
        batch.push({ id: doc._id, set, expect });
        if (batch.length >= BATCH) await flush();
      }
    }
    await flush();
  }

  console.log("Поле и что с ним будет:");
  for (const [key, count] of [...totals].sort()) {
    console.log(`  ${String(count).padStart(6)}  ${key}`);
  }
  if (listed.length) {
    console.log(
      "\nПоимённо (invalid — править руками, split — взят первый номер, plus8 — «+8 (…)» записан как российский, foreign — проверить):",
    );
    for (const line of listed) console.log(line);
  }
  if (!apply) {
    console.log(`\nПоказ без записи: изменятся документы — ${documents}. Повторите с --apply.`);
  } else {
    console.log(`\nСовпало с прочитанным: ${matched} из ${documents}, изменено: ${modified}`);
    if (matched < documents) {
      console.log("Не совпали (документ изменился после чтения, его значения не тронуты):");
      for (const line of missed) console.log(line);
      if (!missed.length) console.log("  (список пуст: эти документы уже держат новые значения)");
      console.log(
        "Прогон не завершён, код выхода 1: раннер не запишет миграцию в журнал. Остановите приложение " +
          "и повторите; перед повтором просмотрите «foreign» выше — записанный номер другой страны из " +
          "10 цифр или с ведущей 8 повторный прогон прочёл бы как российский, и показ его уже не выделит.",
      );
      process.exitCode = 1;
    } else {
      console.log(`Записано документов: ${modified}.`);
    }
  }
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

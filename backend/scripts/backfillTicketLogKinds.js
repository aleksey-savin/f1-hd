const mongoose = require("mongoose");
const TicketLog = require("../models/ticketLog");
const { classify } = require("../services/ticketEvents");

/**
 * Разовый идемпотентный бэкфилл `kind` у хроники заявок.
 *
 * Вид записи проставляет хук модели, но только новым записям: на момент
 * появления поля в базе лежало 230 тысяч событий без него. Пока `kind` пуст,
 * «движение по заявке» (services/ticketActivity.js) не отличить от служебной
 * записи об отправке уведомления — а таких в хронике каждая пятая.
 *
 * Классификатор тот же, что у хука и у ленты карточки
 * (services/ticketEvents.js): второй копии правил не заводим.
 *
 * Идемпотентность: берём только записи без `kind`, поэтому повторный запуск
 * ничего не меняет. Пишем пачками — `updateMany` тут не годится, у каждой
 * записи свой вид.
 */

const BATCH = 1000;

async function backfill() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    const total = await TicketLog.countDocuments({
      kind: { $in: [null, undefined] },
    });
    console.log(`Записей без вида: ${total}`);
    if (total === 0) {
      console.log("✅ Нечего заполнять");
      return;
    }

    const byKind = new Map();
    let processed = 0;
    let operations = [];

    const flush = async () => {
      if (operations.length === 0) return;
      await TicketLog.bulkWrite(operations, { ordered: false });
      operations = [];
    };

    // Курсор по коллекции: тянуть 230 тысяч документов в память незачем,
    // достаточно текста события.
    const cursor = TicketLog.find(
      { kind: { $in: [null, undefined] } },
      { event: 1 },
    )
      .lean()
      .cursor();

    for await (const log of cursor) {
      const kind = classify(log.event || "");
      byKind.set(kind, (byKind.get(kind) || 0) + 1);
      operations.push({
        updateOne: { filter: { _id: log._id }, update: { $set: { kind } } },
      });
      processed += 1;
      if (operations.length >= BATCH) {
        await flush();
        console.log(`  … ${processed} из ${total}`);
      }
    }
    await flush();

    console.log(`✅ Заполнено записей: ${processed}`);
    for (const [kind, count] of [...byKind.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`   ${kind}: ${count}`);
    }
  } catch (error) {
    console.error("❌ Ошибка бэкфилла видов хроники:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

if (require.main === module) {
  backfill();
}

module.exports = { backfill };

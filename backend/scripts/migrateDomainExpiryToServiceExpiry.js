const mongoose = require("mongoose");
const Preferences = require("../models/preferences");
const KnowledgeNote = require("../models/knowledgeNote");
const { runServiceExpiryScan } = require("../services/serviceExpiryScanRun");

// Разовая идемпотентная миграция: фича отслеживания продления переименована с
// «domain» на «service». Переносим пользовательские настройки и пересобираем
// производные данные заметок.
//
// 1. Preferences.knowledgeBase: trackDomainExpiry → trackServiceExpiry и
//    domainExpiryDays → serviceExpiryDays — иначе админская настройка «потеряется»
//    (новый код читает новые ключи), и фича будет выглядеть выключенной.
// 2. Заметки: удаляем устаревшее производное поле domainExpiry и старый индекс,
//    затем заново наполняем serviceExpiry актуальным сканом (если фича включена).
async function migrate() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    // 1. Настройки: переименовываем ключи (только там, где ещё остались старые)
    const prefsResult = await Preferences.updateMany(
      {
        $or: [
          { "knowledgeBase.trackDomainExpiry": { $exists: true } },
          { "knowledgeBase.domainExpiryDays": { $exists: true } },
        ],
      },
      {
        $rename: {
          "knowledgeBase.trackDomainExpiry": "knowledgeBase.trackServiceExpiry",
          "knowledgeBase.domainExpiryDays": "knowledgeBase.serviceExpiryDays",
        },
      },
    );
    console.log(
      `✅ Preferences keys renamed. Matched: ${prefsResult.matchedCount}, modified: ${prefsResult.modifiedCount}`,
    );

    // 2. Заметки: убираем устаревшее производное поле domainExpiry
    const notesResult = await KnowledgeNote.updateMany(
      { domainExpiry: { $exists: true } },
      { $unset: { domainExpiry: "" } },
    );
    console.log(
      `✅ Stale note.domainExpiry removed. Matched: ${notesResult.matchedCount}, modified: ${notesResult.modifiedCount}`,
    );

    // Старый индекс по domainExpiry больше не нужен (best-effort — может отсутствовать)
    try {
      await KnowledgeNote.collection.dropIndex(
        "domainExpiry.entries.expiresAt_1",
      );
      console.log("✅ Dropped old index domainExpiry.entries.expiresAt_1");
    } catch (error) {
      console.log(`ℹ️  Old index not dropped (probably absent): ${error.message}`);
    }

    // 3. Наполняем serviceExpiry актуальными данными (учитывает trackServiceExpiry)
    await runServiceExpiryScan();
    console.log("✅ Service-expiry scan completed");
  } catch (error) {
    console.error("❌ Error migrating domain→service expiry:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run the script if called directly
if (require.main === module) {
  migrate();
}

module.exports = { migrate };

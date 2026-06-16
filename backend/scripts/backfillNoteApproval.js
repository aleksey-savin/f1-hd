const mongoose = require("mongoose");
const KnowledgeNote = require("../models/knowledgeNote");

// Разовый идемпотентный скрипт миграции.
// Проставляет существующим заметкам approved: false — модерация вводится для всех
// заметок, поэтому ранее созданные тоже должны пройти одобрение модератора.
// Mongoose применяет default только к новым документам, поэтому уже сохранённым
// заметкам поле проставляем явно. Код в любом случае трактует отсутствие поля как
// "не одобрено" (approved !== true) — на случай, если скрипт ещё не прогнали.
async function backfillNoteApproval() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    const result = await KnowledgeNote.updateMany(
      { approved: { $exists: false } },
      { $set: { approved: false } },
    );

    console.log(
      `✅ Note approval backfilled. Matched: ${result.matchedCount}, modified: ${result.modifiedCount}`,
    );
  } catch (error) {
    console.error("❌ Error backfilling note approval:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run the script if called directly
if (require.main === module) {
  backfillNoteApproval();
}

module.exports = { backfillNoteApproval };

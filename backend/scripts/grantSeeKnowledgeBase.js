const mongoose = require("mongoose");
const User = require("../models/user");

// Разовый идемпотентный скрипт миграции.
// Выдаёт право canSeeKnowledgeBase всем текущим сотрудникам (не клиентам),
// чтобы база знаний осталась видимой ровно тем, кто видел её до появления права
// (раньше доступ определялся только isNotClient → isEndUser === false).
// Схемный default остаётся false, поэтому новые пользователи получают право явно.
async function grantSeeKnowledgeBase() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    const result = await User.updateMany(
      { isEndUser: false },
      { $set: { "permissions.canSeeKnowledgeBase": true } },
    );

    console.log(
      `✅ canSeeKnowledgeBase granted. Matched: ${result.matchedCount}, modified: ${result.modifiedCount}`,
    );
  } catch (error) {
    console.error("❌ Error granting canSeeKnowledgeBase:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run the script if called directly
if (require.main === module) {
  grantSeeKnowledgeBase();
}

module.exports = { grantSeeKnowledgeBase };

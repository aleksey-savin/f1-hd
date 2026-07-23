// Разовый бэкофилл User.lastActivityAt = дата последней созданной пользователем
// заявки (по коллекции tickets). Нужен один раз при выкатке серверной
// сортировки/фильтра «активности» в списке «Пользователи»; далее поле
// поддерживается хуком модели ticket при создании заявки.
//
// Запуск внутри backend-контейнера:
//   docker compose exec backend node scripts/backfillUserLastActivity.js
const mongoose = require("mongoose");

const User = require("../models/user");
const { Ticket } = require("../models/ticket");

async function backfillUserLastActivity() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    // Последняя заявка на заявителя: applicantId (актуальное) либо legacy
    // applicant._id. $max по createdAt — дата последней активности.
    const latest = await Ticket.aggregate([
      {
        $match: {
          $or: [
            { applicantId: { $ne: null } },
            { "applicant._id": { $ne: null } },
          ],
        },
      },
      {
        $group: {
          _id: { $ifNull: ["$applicantId", "$applicant._id"] },
          last: { $max: "$createdAt" },
        },
      },
    ]);

    console.log(`Найдено заявителей с заявками: ${latest.length}`);

    let updated = 0;
    for (const row of latest) {
      if (!row._id || !row.last) continue;
      const result = await User.updateOne(
        { _id: row._id },
        { $set: { lastActivityAt: row.last } },
      );
      if (result.matchedCount) updated += 1;
    }

    console.log(`✓ lastActivityAt проставлен пользователям: ${updated}`);
  } catch (error) {
    console.error("Ошибка бэкофилла lastActivityAt:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

backfillUserLastActivity();

const mongoose = require("mongoose");
const TicketTemplate = require("../models/ticketTemplate");
const { genFieldKey } = require("../services/ticketQuestionnaire");

// Разовая идемпотентная миграция: у вопросов шаблонов, заведённых до появления
// ключей, ключа нет — ответы к ним сверяются по названию (запасная ветка
// services/ticketQuestionnaire.collectAnswers). Выдаём ключ каждому такому
// вопросу, чтобы сверка шла по ключу с первого дня и переименование вопроса в
// шаблоне не отвязывало обязательность от ответов. Без миграции ключи всё равно
// появятся — при первом сохранении каждого шаблона.
async function migrate() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    // null в $in ловит и отсутствующее поле
    const templates = await TicketTemplate.find({
      "customFields.key": { $in: [null, ""] },
    });

    let touched = 0;
    for (const template of templates) {
      let changed = false;
      for (const field of template.customFields) {
        if (!field.key) {
          field.key = genFieldKey();
          changed = true;
        }
      }
      if (changed) {
        await template.save();
        touched += 1;
      }
    }
    console.log(`✅ Ключи выданы: шаблонов обновлено ${touched} из ${templates.length}`);
  } catch (error) {
    console.error("❌ Миграция не удалась:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

migrate();

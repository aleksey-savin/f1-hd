// Одноразовый перенос настроек ИИ: провайдер «YandexGPT» → «Yandex AI Studio»
// (2026-07-31). Foundation Models переименованы в AI Studio — это один сервис с
// общим каталогом моделей и общей авторизацией, поэтому в настройках остался
// один яндексовый провайдер.
//   ai.provider: "yandexgpt" → "yandexai"
//   ai.yandexgpt.{apiKey,folderId,model} → ai.yandexai.* (если там пусто)
//   ai.yandexgpt → удаляется
// Идемпотентен: повторный запуск ничего не меняет. Работает через нативный
// драйвер, потому что читает поля, которых в схеме уже нет.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateAiProvider.js
require("module-alias/register");
const mongoose = require("mongoose");

const Preferences = require("../models/preferences");
const { encryptSecret, isEncrypted } = require("../services/crypto/secretBox");

// Ключ мог остаться открытым текстом (сохранён до ввода шифрования) — тогда
// шифруем его по дороге, как это делает сохранение настроек.
const carrySecret = (value) =>
  isEncrypted(value) ? value : encryptSecret(value);

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const collection = Preferences.collection;
  const document = await collection.findOne({});

  if (!document?.ai) {
    console.log("Настроек ИИ нет — переносить нечего");
    await mongoose.disconnect();
    return;
  }

  const legacy = document.ai.yandexgpt;
  const current = document.ai.yandexai || {};
  const set = {};
  const unset = {};
  const notes = [];

  if (document.ai.provider === "yandexgpt") {
    set["ai.provider"] = "yandexai";
    notes.push("провайдер: YandexGPT → Yandex AI Studio");
  }

  if (legacy) {
    // Настроенный AI Studio главнее: если там уже что-то есть, старые значения
    // не затираем — их перенос был бы откатом чужой настройки.
    if (legacy.apiKey && !current.apiKey) {
      set["ai.yandexai.apiKey"] = carrySecret(legacy.apiKey);
      notes.push("перенесён API-ключ");
    }
    if (legacy.folderId && !current.folderId) {
      set["ai.yandexai.folderId"] = legacy.folderId;
      notes.push(`перенесён каталог ${legacy.folderId}`);
    }
    if (legacy.model && !current.model) {
      set["ai.yandexai.model"] = legacy.model;
      notes.push(`перенесена модель ${legacy.model}`);
    }
    unset["ai.yandexgpt"] = "";
  }

  if (!Object.keys(set).length && !Object.keys(unset).length) {
    console.log("Настройки ИИ уже в новой форме — изменений нет");
    await mongoose.disconnect();
    return;
  }

  await collection.updateOne(
    { _id: document._id },
    {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
  );

  notes.forEach((note) => console.log(` • ${note}`));
  console.log(
    "Готово. Откройте «Настройки → ИИ», обновите список моделей и нажмите " +
      "«Проверить»: каталог AI Studio отличается от прежнего фиксированного " +
      "списка (например, yandexgpt-32k в нём нет).",
  );
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Не удалось перенести настройки ИИ:", error);
  process.exit(1);
});

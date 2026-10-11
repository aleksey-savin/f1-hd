// Разовый перенос прежнего бренда в настройки, 2026-10-11.
//
// До настроек «Бренд» название портала и подпись в письмах были зашиты в код.
// Установке, которая уже работает, они должны остаться прежними — её письма и
// заголовки читаются как раньше; свежая установка получает умолчания продукта.
//
// Самих прежних строк в репозитории нет: их передают окружением на время
// обновления —
//   LEGACY_BRAND_NAME        название портала
//   LEGACY_BRAND_SIGNATURE   подпись в письмах (перевод строки — `\n` или <br>)
//
// Пишет, только если ВСЁ сразу:
//   • документ настроек есть и название портала в нём пустое;
//   • в базе есть пользователи (установка не свежая);
//   • переменные заданы.
// Иначе ничего не пишет и говорит почему. Подпись, уже заданную в настройках,
// не затирает. Идемпотентен.
//
// ВАЖНО: раннер (scripts/migrate.js) отмечает запись применённой и тогда, когда
// скрипт ничего не записал. Если переменные забыли — после обновления прогнать
// руками, с ними:
//   node scripts/seedBrand.js            # показать
//   node scripts/seedBrand.js --apply    # записать
require("module-alias/register");

const { validateBrandInput } = require("@/services/brand");

const text = (value) => (typeof value === "string" ? value.trim() : "");

// Подпись из окружения: одна строка, поэтому перевод строки приходит как `\n`
// (два знака) или как <br> из прежней вёрстки письма
const signatureFromEnv = (value) =>
  text(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n");

/**
 * Что записать: `{ set, lines }` — поля для `$set` (или null) и строки отчёта.
 * Чистая функция: базу и окружение ей передают.
 */
const planBrandSeed = ({ preferences, users, env }) => {
  if (!preferences) {
    return { set: null, lines: ["Настроек ещё нет — свежая установка, бренд по умолчанию."] };
  }
  if (text(preferences.brand?.productName)) {
    return { set: null, lines: ["Название портала уже задано — ничего не меняем."] };
  }
  if (!users) {
    return { set: null, lines: ["Пользователей нет — свежая установка, бренд по умолчанию."] };
  }

  const name = text(env.LEGACY_BRAND_NAME);
  const signature = signatureFromEnv(env.LEGACY_BRAND_SIGNATURE);
  if (!name && !signature) {
    return {
      set: null,
      lines: [
        "LEGACY_BRAND_NAME и LEGACY_BRAND_SIGNATURE не заданы — ничего не записано.",
        "Портал получит название и подпись по умолчанию. Чтобы оставить прежние,",
        "задайте переменные и повторите: node scripts/seedBrand.js --apply",
      ],
    };
  }

  const checked = validateBrandInput({ productName: name, mailSignature: signature });
  if (checked.error) return { error: checked.error };

  const set = {};
  const lines = [];
  if (name) {
    set["brand.productName"] = checked.value.productName;
    lines.push(`Название портала: «${checked.value.productName}»`);
  } else {
    lines.push("LEGACY_BRAND_NAME не задана — название портала останется по умолчанию.");
  }
  if (!signature) {
    lines.push("LEGACY_BRAND_SIGNATURE не задана — подпись останется по умолчанию.");
  } else if (text(preferences.brand?.mailSignature)) {
    lines.push("Подпись в письмах уже задана — её не меняем.");
  } else {
    set["brand.mailSignature"] = checked.value.mailSignature;
    lines.push(`Подпись в письмах: «${checked.value.mailSignature.replace(/\n/g, " / ")}»`);
  }

  return { set: Object.keys(set).length ? set : null, lines };
};

const run = async () => {
  const mongoose = require("mongoose");
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  const preferences = await db.collection("preferences").findOne({});
  const users = await db.collection("users").countDocuments();

  const plan = planBrandSeed({ preferences, users, env: process.env });
  if (plan.error) throw new Error(`Прежний бренд не подходит: ${plan.error}`);

  for (const line of plan.lines) console.log(`  ${line}`);

  if (!plan.set) {
    console.log("\nМенять нечего.");
  } else if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
  } else {
    // Только по _id прочитанного документа и только названные поля
    await db.collection("preferences").updateOne({ _id: preferences._id }, { $set: plan.set });
    console.log("\nБренд записан в настройки.");
  }

  await mongoose.disconnect();
};

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { planBrandSeed };

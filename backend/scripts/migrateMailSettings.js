// Одноразовый перенос настроек почты в новую форму (рефактор почтовых каналов,
// 2026-07-25):
//   • useEmail/emailAddress/emailPassword/imapServer  →  mailbox.*
//   • notify.byEmail.isSecure                          →  notify.byEmail.security
//   • пароли ящика и SMTP, ключи AI-провайдеров        →  шифртекст secretBox
// Идемпотентен: повторный запуск ничего не меняет (гарды на «уже перенесено» и
// isEncrypted). Работает через нативный драйвер, потому что читает и удаляет
// поля, которых в схеме уже нет.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateMailSettings.js
require("module-alias/register");
const mongoose = require("mongoose");

const Preferences = require("../models/preferences");
const { encryptSecret, isEncrypted } = require("../services/crypto/secretBox");
const { SECRET_PATHS } = require("../helpers/preferencesSecrets");

const getByPath = (source, path) =>
  path.split(".").reduce((node, key) => (node == null ? node : node[key]), source);

// Старый транспорт SMTP знал единственный флаг isSecure. true — это всегда
// implicit TLS (465). false у nodemailer означало «подключиться открыто и
// подняться до TLS, если сервер умеет»: для 25-го порта это на практике
// незашифрованный релей, для остальных — STARTTLS.
const securityFromLegacyFlag = (isSecure, port) => {
  if (isSecure) return "ssl";
  return Number(port) === 25 ? "none" : "starttls";
};

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const collection = Preferences.collection;
  const document = await collection.findOne({});

  if (!document) {
    console.log("Документ настроек не найден — переносить нечего");
    await mongoose.disconnect();
    return;
  }

  const set = {};
  const unset = {};
  const notes = [];

  // ── Ящик-приёмник ────────────────────────────────────────────────────────
  const hasLegacyMailbox =
    document.emailAddress !== undefined ||
    document.imapServer !== undefined ||
    document.useEmail !== undefined ||
    document.emailPassword !== undefined;

  if (hasLegacyMailbox && !document.mailbox?.host) {
    set.mailbox = {
      isActive: !!document.useEmail,
      address: document.emailAddress || "",
      host: document.imapServer || "",
      port: 993,
      security: "ssl",
      folder: "INBOX",
      allowSelfSigned: false,
      password: document.emailPassword
        ? isEncrypted(document.emailPassword)
          ? document.emailPassword
          : encryptSecret(document.emailPassword)
        : "",
      health: {
        lastCheckedAt: null,
        lastOkAt: null,
        lastMessageAt: null,
        lastError: "",
        lastErrorHint: "",
        lastErrorAt: null,
        consecutiveFailures: 0,
      },
    };
    notes.push(
      `ящик: ${document.imapServer || "—"} → mailbox (993/SSL, папка INBOX)`,
    );
  }

  if (hasLegacyMailbox) {
    unset.useEmail = "";
    unset.emailAddress = "";
    unset.emailPassword = "";
    unset.imapServer = "";
  }

  // ── Канал SMTP ───────────────────────────────────────────────────────────
  const smtp = document.notify?.byEmail;
  if (smtp) {
    if (smtp.isSecure !== undefined && smtp.security === undefined) {
      const security = securityFromLegacyFlag(smtp.isSecure, smtp.port);
      set["notify.byEmail.security"] = security;
      notes.push(
        `SMTP: isSecure=${!!smtp.isSecure}, порт ${smtp.port} → шифрование «${security}»`,
      );
    }
    if (smtp.isSecure !== undefined) {
      unset["notify.byEmail.isSecure"] = "";
    }
    if (smtp.authMethod === undefined) {
      // Пустая учётка = релей без авторизации; иначе вход по паролю
      const method = smtp.user || smtp.pass ? "password" : "none";
      set["notify.byEmail.authMethod"] = method;
      notes.push(`SMTP: способ входа «${method}»`);
    }
    if (smtp.allowSelfSigned === undefined) {
      set["notify.byEmail.allowSelfSigned"] = false;
    }
  }

  // ── Секреты в шифртекст ──────────────────────────────────────────────────
  // mailbox.password уже обработан выше (внутри переносимой группы).
  for (const path of SECRET_PATHS) {
    if (path === "mailbox.password") continue;
    const value = getByPath(document, path);
    if (!value || isEncrypted(value)) continue;
    set[path] = encryptSecret(value);
    notes.push(`зашифрован секрет ${path}`);
  }

  if (!Object.keys(set).length && !Object.keys(unset).length) {
    console.log("Настройки уже в новой форме — изменений нет");
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
    "Готово. Проверьте секции «Сбор заявок» и «Уведомления»: порт и режим " +
      "шифрования IMAP выставлены по умолчанию (993/SSL) — если ящик слушает " +
      "иначе, поправьте и нажмите «Проверить».",
  );
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Не удалось перенести настройки почты:", error);
  process.exit(1);
});

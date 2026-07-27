const Notification = require("@/models/notification");
const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");

/**
 * Уведомления об отсутствиях. Кладём документы в ту же очередь Notification,
 * из которой шлёт telegram-bot, — своего транспорта не заводим.
 *
 * Гейты те же три, что у заявочных уведомлений (middleware/notifications):
 * канал включён в настройках → категория включена глобально → категория
 * включена у получателя. Ключ категории един для personal / byTelegram /
 * byEmail: absenceRequest (согласующим) и absenceDecision (заявителю).
 */
const notifyAbsence = async ({ recipients, text, category, title }) => {
  const prefs = await Preferences.findOne({}).lean();
  if (!prefs) {
    return;
  }

  const tgAllowed =
    prefs.notify?.byTelegram?.isActive && prefs.notify?.personal?.[category];
  const emailAllowed =
    // В dev почту подавляем, как и в заявочных уведомлениях
    process.env.NODE_ENV !== "development" &&
    prefs.notify?.byEmail?.isActive &&
    prefs.notify?.personal?.[category];

  const documents = [];
  for (const user of recipients || []) {
    if (!user) {
      continue;
    }
    const who = `${user.lastName || ""} ${user.firstName || ""}`.trim();

    if (tgAllowed && user.telegramBot?.isActive && user.notify?.byTelegram?.[category]) {
      documents.push({
        instrument: "telegram",
        to: { chatId: user.telegramBot.chatId, applicant: who },
        title,
        text,
      });
    }

    if (emailAllowed && user.email && user.notify?.byEmail?.[category]) {
      documents.push({
        instrument: "email",
        to: { email: user.email, applicant: who },
        title: title || "Отсутствие",
        text,
      });
    }
  }

  if (!documents.length) {
    return;
  }

  await Notification.insertMany(documents);
  logger.log("notification", "Absence notifications queued", {
    category,
    count: documents.length,
  });
};

module.exports = { notifyAbsence };

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
    prefs.notify?.byEmail?.isActive &&
    prefs.notify?.personal?.[category];

  const documents = [];
  for (const user of recipients || []) {
    if (!user) {
      continue;
    }
    const who = `${user.lastName || ""} ${user.firstName || ""}`.trim();

    // Отсутствие поля = включено: в схеме у категории default true, но на уже
    // сохранённых пользователях поля нет (дефолты применяются при создании
    // документа). Строгая проверка означала бы «никому не слать никогда».
    if (
      tgAllowed &&
      user.telegramBot?.isActive &&
      user.notify?.byTelegram?.[category] !== false
    ) {
      documents.push({
        instrument: "telegram",
        to: { chatId: user.telegramBot.chatId, applicant: who },
        title,
        text,
      });
    }

    if (emailAllowed && user.email && user.notify?.byEmail?.[category] !== false) {
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

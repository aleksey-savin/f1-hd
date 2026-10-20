// Общая рассылка события по трём каналам: Telegram, почта (очередь Notification) и колокольчик.
// Вынесено из services/mikrotik/changeNotifications.js без изменения поведения; категория и зависимости приходят аргументами.
const { escapeHtml } = require("../telegramMessage");

const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));
// Чужой текст — в одну строку и с потолком: перевод строки в имени подделывает строки записи очереди
const oneLine = (text, max) => {
  // \s не знает NEL и разделителей U+001C–U+001F — для подписи это тоже переводы строки
  // eslint-disable-next-line no-control-regex -- вычищаем разделители \u001c-\u001f и NEL: JS не считает их пробелами
  const t = String(text ?? "").replace(/[\s\u0085\u001c-\u001f]+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const personName = (user) => oneLine([user?.firstName, user?.lastName].filter(Boolean).join(" "), 80);
const usable = (user) => Boolean(user) && user.isServiceAccount !== true && user.banned !== true;

function createFanOut({ loadUsers, loadPrefs, saveNotifications, pushInApp, category, log, logPrefix = "Notification" }) {
  const CATEGORY = category;
  const warn = (message, error) => {
    try { log?.log?.("warn", `${logPrefix}: ${message}`, { error: error?.message }); } catch { /* журнал не критичен */ }
  };

  // Уникальные адресаты события в порядке перечисления.
  const unique = (ids) => [...new Set(ids.map(idOf).filter(Boolean))];

  // telegram.force — экран решения по собственной просьбе человека: выключатели категории (личный в
  // настройках организации и у пользователя) его не гасят, как и колокольчик. Нужны включённый канал
  // Telegram и привязанный бот. count: "telegram" — вернуть число только Telegram-сообщений.
  return async function fanOut(change, { ids, kind, title, mailTitle, telegram, bell, mail, link, count }) {
    const users = ((await loadUsers(unique(ids))) || []).filter(usable);
    const prefs = loadPrefs ? await loadPrefs() : null;
    const tgChannel = prefs?.notify?.byTelegram?.isActive;
    const tgForce = telegram.force === true;
    const tgOn = tgChannel && (tgForce || prefs?.notify?.personal?.[CATEGORY]);
    const mailOn = prefs?.notify?.byEmail?.isActive && prefs?.notify?.personal?.[CATEGORY];
    const docs = [];
    for (const user of users) {
      const who = personName(user);
      if (tgOn && user.telegramBot?.isActive && user.telegramBot.chatId && (tgForce || user.notify?.byTelegram?.[CATEGORY] !== false)) {
        docs.push({ instrument: "telegram", to: { chatId: user.telegramBot.chatId, applicant: who }, title, text: escapeHtml(telegram.text), replyMarkup: telegram.replyMarkup });
      }
      if (mailOn && user.email && user.notify?.byEmail?.[CATEGORY] !== false) {
        docs.push({ instrument: "email", to: { email: user.email, applicant: who }, title: mailTitle, text: mail });
      }
    }
    // Каналы независимы: сбой одного не отменяет другой. В журнал — только сообщение ошибки.
    // Колокольчик — всегда (force): выключатели категории его не гасят
    try {
      await pushInApp({ recipients: users, category: CATEGORY, kind, title, text: bell, link, prefs, force: true });
    } catch (error) { warn(`bell #${change.number}`, error); }
    if (docs.length) {
      try { await saveNotifications(docs); } catch (error) { warn(`queue #${change.number}`, error); return 0; }
    }
    return count === "telegram" ? docs.filter((doc) => doc.instrument === "telegram").length : docs.length;
  };
}

module.exports = { createFanOut };

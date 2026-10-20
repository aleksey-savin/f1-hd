// Уведомления о предложениях ИИ-агента по инвентарю: Telegram (с кнопками), колокольчик, почта.
// Получатель один — заявитель. Рассылка общая с Mikrotik (services/notifications/fanOut).
// Чистый модуль: зависимости приходят аргументами, логгер и модели при загрузке не подключаем.
const { createFanOut } = require("../notifications/fanOut");
const { escapeHtml } = require("../telegramMessage");
const {
  present, linkKeyboard, resultFor, resultTitle, expiredFor, mailUrl, oneLine, pathOf, quotedTitle,
} = require("./changeRender");

const CATEGORY = "inventoryChange";
const DEFAULT_TZ = "Europe/Moscow";

function createInventoryChangeNotifier({ loadUsers, loadContext, loadPrefs, saveNotifications, pushInApp, baseUrl, log }) {
  const warn = (message, error) => {
    try { log?.log?.("warn", `Inventory change notification: ${message}`, { error: error?.message }); } catch { /* журнал не критичен */ }
  };
  const fanOutShared = createFanOut({
    loadUsers, loadPrefs, saveNotifications, pushInApp, category: CATEGORY, log, logPrefix: "Inventory change notification",
  });
  const fanOut = (change, args) => fanOutShared(change, { ...args, link: pathOf(change) });

  const context = async (change) => {
    try { return (await loadContext?.(change)) || {}; } catch (error) { warn("context", error); return {}; }
  };

  // Письмо уходит как HTML: чужой текст экранируется, переводы строк — <br>. Ссылка — из baseUrl и фиксированного пути.
  const withLink = (text, change) => {
    const body = escapeHtml(text).replace(/\n/g, "<br>");
    const url = mailUrl(baseUrl, change);
    return url ? `${body}<br><br><a href="${escapeHtml(url).replace(/"/g, "&quot;")}">Открыть в портале</a>` : body;
  };

  const ids = (change) => [change.requestedBy];

  // Экран решения: Telegram уходит мимо выключателей категории (force) — это ответ на собственную
  // просьбу человека, утвердить больше негде. Возвращает число Telegram-сообщений в очереди
  // (0 — человек не получит кнопок: нет привязанного бота или канал Telegram выключен).
  async function proposed(change) {
    const ctx = await context(change);
    const { text, keyboard } = present(change, { baseUrl, timezone: ctx.timezone || DEFAULT_TZ });
    const title = oneLine(change.title, 200);
    return fanOut(change, {
      ids: ids(change),
      kind: "inventoryChangeProposed",
      title: "Предложение ИИ-агента по технике ждёт вашего решения",
      mailTitle: `Предложение ИИ-агента по технике: ${title}`,
      telegram: { text, replyMarkup: keyboard, force: true },
      count: "telegram",
      bell: `${quotedTitle(change)}. Операций в пакете: ${(change.operations || []).length}`,
      mail: withLink(text, change),
    });
  }

  async function final(change) {
    const text = resultFor(change);
    const title = resultTitle(change);
    return fanOut(change, {
      ids: ids(change),
      kind: "inventoryChangeResult",
      title,
      mailTitle: `${title}: ${oneLine(change.title, 200)}`,
      telegram: { text, replyMarkup: linkKeyboard(change, baseUrl) },
      bell: quotedTitle(change),
      mail: withLink(text, change),
    });
  }

  async function expired(change) {
    const text = expiredFor(change);
    return fanOut(change, {
      ids: ids(change),
      kind: "inventoryChangeResult",
      title: "Предложение истекло",
      mailTitle: text,
      telegram: { text, replyMarkup: linkKeyboard(change, baseUrl) },
      bell: quotedTitle(change),
      mail: withLink(text, change),
    });
  }

  const safe = (fn) => async (change) => {
    try { return await fn(change); } catch (error) { warn(`${change?.number}`, error); return 0; }
  };

  return { proposed: safe(proposed), decided: safe(final), result: safe(final), expired: safe(expired) };
}

// Настройки из базы читаются lean: у установок, где админ не сохранял настройки после появления категории,
// ключа notify.personal.inventoryChange нет. Отсутствующий ключ читаем как значение схемы по умолчанию (включено).
function withDefaults(prefs) {
  if (!prefs) return prefs;
  const personal = { ...(prefs.notify?.personal || {}) };
  if (personal[CATEGORY] === undefined) personal[CATEGORY] = true;
  return { ...prefs, notify: { ...(prefs.notify || {}), personal } };
}

// Контекст сообщения: пояс организации (как у Mikrotik)
const makeLazy = () => {
  const loaded = {};
  return (name, path) => (loaded[name] ||= require(path));
};

// Боевая сборка: единственное место с моделями. Не покрыта тестами (нужна база).
function mongoNotifier({ baseUrl, log } = {}) {
  const lazy = makeLazy();
  return createInventoryChangeNotifier({
    baseUrl,
    log,
    pushInApp: (args) => require("@/services/inAppNotifications").pushInApp(args),
    saveNotifications: (docs) => lazy("N", "@/models/notification").insertMany(docs),
    loadPrefs: async () => {
      const Preferences = lazy("P", "@/models/preferences");
      const doc = await Preferences.findOne({}).lean();
      return doc ? withDefaults(Preferences.hydrate(doc).toObject()) : doc;
    },
    loadUsers: (ids) =>
      lazy("U", "@/models/user").find({ _id: { $in: ids } })
        .select("firstName lastName email telegramBot notify isServiceAccount banned").lean(),
    loadContext: async () => {
      const prefs = await lazy("P", "@/models/preferences").findOne({}).select("timezone").lean();
      return { timezone: prefs?.timezone || DEFAULT_TZ };
    },
  });
}

module.exports = { CATEGORY, withDefaults, createInventoryChangeNotifier, mongoNotifier };

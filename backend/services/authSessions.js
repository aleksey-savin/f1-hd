const mongoose = require("mongoose");

/**
 * Отзыв сессий — прямым запросом к коллекции better-auth, а не через `auth.api`.
 *
 * Его ручки рассчитаны на «я гашу СВОИ сессии»: им нужны заголовки запроса, то
 * есть чужая сессия из контроллера или из крона так не гасится. Нам же нужно
 * ровно обратное: администратор отключает учётку, компания уходит в архив,
 * пароль сброшен — и всё это должно немедленно выкинуть человека отовсюду.
 *
 * До появления better-auth отзыва не существовало вовсе: выход был
 * `localStorage.removeItem` на клиенте, а выданный JWT жил свои четырнадцать
 * дней.
 */

const collection = () => mongoose.connection.db.collection("authSessions");

/**
 * userId в документах адаптера — ObjectId, но версия адаптера может изменить
 * форму, и односторонний фильтр тогда молча перестал бы что-либо гасить.
 * Ищем обоими способами: лишнее условие стоит ничего, а тихо не сработавший
 * отзыв доступа — дорого.
 */
const byUser = (userId) => {
  const id = String(userId);
  const conditions = [{ userId: id }];
  if (mongoose.isValidObjectId(id)) {
    conditions.push({ userId: new mongoose.Types.ObjectId(id) });
  }
  return { $or: conditions };
};

/** Погасить все сеансы человека. Возвращает число снятых. */
const revokeAllForUser = async (userId) => {
  const { deletedCount } = await collection().deleteMany(byUser(userId));
  return deletedCount;
};

/** Погасить все сеансы, кроме текущего — для «выйти на остальных устройствах». */
const revokeOthersForUser = async (userId, keepToken) => {
  const { deletedCount } = await collection().deleteMany({
    ...byUser(userId),
    token: { $ne: keepToken },
  });
  return deletedCount;
};

/**
 * Браузер и ОС из строки User-Agent.
 *
 * Тридцать строк вместо зависимости: в списке сеансов человеку нужен ответ
 * «моё это устройство или нет», и на него отвечают два слова. Сырую строку в
 * интерфейс отдавать нельзя — `Mozilla/5.0 (Windows NT 10.0; Win64; x64)
 * AppleWebKit/537.36…` не узнаёт никто, включая того, кто её написал.
 *
 * Порядок проверок значим: Edge представляется и Chrome, и Safari; Chrome —
 * Safari; Opera — Chrome. Поэтому идём от частного к общему.
 */
const BROWSERS = [
  [/\bEdgA?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bYaBrowser\//, "Яндекс.Браузер"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const SYSTEMS = [
  [/\bWindows NT/, "Windows"],
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bMac OS X\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

const MOBILE = new Set(["iPhone", "iPad", "Android"]);

const describeDevice = (userAgent) => {
  const ua = String(userAgent || "");
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] || null;
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1] || null;

  return {
    browser,
    system,
    mobile: MOBILE.has(system),
    // Неизвестную связку не выдумываем: «Неизвестное устройство» честнее, чем
    // угаданный «Chrome», и это сигнал, что заходили не из браузера.
    title:
      [browser, system].filter(Boolean).join(" · ") || "Неизвестное устройство",
  };
};

/**
 * Сеансы человека в виде, пригодном для интерфейса.
 *
 * ТОКЕН НАРУЖУ НЕ УХОДИТ НИКОГДА: он и есть удостоверение, и в списке
 * устройств ему делать нечего. Строку опознаёт `id`, а сопоставление
 * «id → токен» живёт только на сервере (см. `revokeById`).
 */
const listForUser = async (userId, currentToken) => {
  const rows = await collection()
    .find(byUser(userId))
    .sort({ updatedAt: -1 })
    .toArray();

  return rows.map((row) => ({
    id: String(row._id),
    device: describeDevice(row.userAgent),
    ip: row.ipAddress || null,
    createdAt: row.createdAt,
    // «Активна» — это updatedAt: человек спрашивает, когда с устройства
    // заходили в последний раз, а не когда сеанс протухнет.
    lastActiveAt: row.updatedAt || row.createdAt,
    current: Boolean(currentToken) && row.token === currentToken,
    // Сеанс подмены помечен: это единственное место, где видно, что прямо
    // сейчас кто-то работает под этим человеком.
    impersonatedBy: row.impersonatedBy ? String(row.impersonatedBy) : null,
  }));
};

/** Погасить один сеанс по его id — и только у своего владельца. */
const revokeById = async (userId, sessionId) => {
  if (!mongoose.isValidObjectId(String(sessionId))) return 0;
  const { deletedCount } = await collection().deleteOne({
    ...byUser(userId),
    _id: new mongoose.Types.ObjectId(String(sessionId)),
  });
  return deletedCount;
};

/** Погасить сеансы всех сотрудников компании — каскад от `company.toggleActive`. */
const revokeAllForCompany = async (companyId) => {
  const User = require("@/models/user");
  const users = await User.find({ "company._id": companyId })
    .select("_id")
    .lean();
  let total = 0;
  for (const user of users) {
    total += await revokeAllForUser(user._id);
  }
  return total;
};

module.exports = {
  revokeAllForUser,
  revokeOthersForUser,
  listForUser,
  revokeById,
  describeDevice,
  revokeAllForCompany,
};

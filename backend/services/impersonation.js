const crypto = require("crypto");
const mongoose = require("mongoose");

/**
 * Вход под пользователем — через ОДНОРАЗОВЫЙ КОД, а не подменой текущей вкладки.
 *
 * Штатная ручка плагина гасит cookie администратора, ставит вместо неё чужую, а
 * свою прячет в отдельную; возврат тогда зависит от этой спрятанной cookie, и
 * если в чужом сеансе что-то пойдёт не так, вернуться нечем. Мы её заголовки в
 * ответ не переносим вовсе: вкладка администратора остаётся своей, а токен
 * нового сеанса уезжает ссылкой в другой браузер.
 *
 * В ссылке НЕ ТОКЕН СЕАНСА. Токен — это удостоверение на час, и в адресной
 * строке он попал бы в `access.log` nginx и в историю браузера (ровно та
 * ошибка, что была у телеграм-бота). Вместо него короткий код: обменивается
 * один раз, живёт десять минут и хранится хешем — выгрузка коллекции не даёт
 * ни одного рабочего кода.
 */

const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Предел работы под чужой учётной записью — час, и меряется он ОТ СОЗДАНИЯ
 * сеанса, а не по его `expiresAt`.
 *
 * better-auth продлевает сеанс, когда до конца осталось меньше `updateAge`
 * (`api/routes/session.mjs`: `expiresAt - expiresIn + updateAge <= now`). У нас
 * сеанс живёт 14 суток и продлевается раз в сутки — значит любой сеанс с
 * остатком меньше 13 суток при первом же запросе получает полные 14. Час,
 * который выставляет плагин, съедался на первом обращении, и сеанс подмены
 * становился обычным двухнедельным. Проверка живёт в `attachSession`.
 */
const SESSION_MAX_MS = 60 * 60 * 1000;

const codes = () =>
  mongoose.connection.db.collection("impersonationCodes");

const hash = (code) => crypto.createHash("sha256").update(code).digest("hex");

/**
 * Выдать код на готовый сеанс. Сам сеанс создаёт плагин — форма его записи его
 * внутреннее дело, и руками мы её не трогаем.
 */
const issue = async ({ sessionToken, targetId, adminId }) => {
  const code = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await codes().insertOne({
    code: hash(code),
    sessionToken,
    targetId: String(targetId),
    adminId: String(adminId),
    createdAt: new Date(),
    expiresAt,
  });

  return { code, expiresAt };
};

/**
 * Обменять код на токен сеанса. Одноразовость обеспечивается удалением в том же
 * запросе, что и чтение: `findOneAndDelete` атомарен, поэтому два одновременных
 * обмена не могут оба получить токен.
 */
const claim = async (code) => {
  if (!code || typeof code !== "string") return null;

  const row = await codes().findOneAndDelete({ code: hash(code) });
  const found = row?.value || row;
  if (!found?.sessionToken) return null;

  // Срок проверяем сами: индекс TTL чистит раз в минуту и на секунды опаздывает.
  if (found.expiresAt && found.expiresAt < new Date()) return null;

  return { sessionToken: found.sessionToken, targetId: found.targetId };
};

module.exports = { issue, claim, CODE_TTL_MS, SESSION_MAX_MS };

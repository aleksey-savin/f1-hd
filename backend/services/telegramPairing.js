const crypto = require("crypto");
const mongoose = require("mongoose");

/**
 * Привязка телеграма — через ОДНОРАЗОВЫЙ КОД, а не через `user._id`.
 *
 * Раньше «кодом» в диплинке `t.me/бот?start=…` был сырой `_id` пользователя
 * (`frontend/.../Integrations.jsx`), а бэкенд по нему просто находил учётку и
 * записывал присланный `chatId`. Идентификатор не секрет: он приезжает в
 * браузер в каждой заявке (`applicantId`, `responsibles`), в `/api/me`, в
 * списках пользователей. Значит любой, кто видел хоть одну заявку, мог
 * отправить боту `/start <чужой id>` и привязать СВОЙ телеграм к ЧУЖОЙ учётке:
 * получать её уведомления, заводить заявки от её имени, менять её статус
 * присутствия — и попутно отцепить настоящего владельца, потому что запись
 * `chatId` шла поверх.
 *
 * Устройство — то же, что у входа под пользователем (`services/impersonation`):
 * код случайный, живёт минуты, обменивается один раз и хранится хешем, так что
 * выгрузка коллекции не даёт ни одного рабочего кода.
 *
 * 32 байта в base64url — 43 символа, и это осознанно: у `?start=` предел 64
 * символа, а алфавит ограничен `[A-Za-z0-9_-]`, куда base64url укладывается
 * ровно (в отличие от base64 с его `+/=`).
 */

const CODE_TTL_MS = 15 * 60 * 1000;

const codes = () => mongoose.connection.db.collection("telegramPairingCodes");

const hash = (code) => crypto.createHash("sha256").update(code).digest("hex");

/** Выдать код на привязку. Возвращается открытым ровно один раз — здесь. */
const issue = async (userId) => {
  const code = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await codes().insertOne({
    code: hash(code),
    userId: String(userId),
    createdAt: new Date(),
    expiresAt,
  });

  return { code, expiresAt };
};

/**
 * Обменять код на идентификатор пользователя. Одноразовость обеспечивается
 * удалением в том же запросе, что и чтение: `findOneAndDelete` атомарен,
 * поэтому два одновременных обмена не могут оба получить учётку.
 */
const claim = async (code) => {
  if (!code || typeof code !== "string") return null;

  const row = await codes().findOneAndDelete({ code: hash(code) });
  const found = row?.value || row;
  if (!found?.userId) return null;

  // Срок проверяем сами: индекс TTL чистит раз в минуту и на секунды опаздывает.
  if (found.expiresAt && found.expiresAt < new Date()) return null;

  return { userId: found.userId };
};

module.exports = { issue, claim, CODE_TTL_MS };

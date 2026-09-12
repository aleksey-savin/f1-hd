const { effectivePermissions } = require("@/services/permissions");
const { isStaffAdmin } = require("@/auth/access");
const { isBanned } = require("@/services/authBan");
const { authorizeFor } = require("@/auth/bootstrap");

/**
 * Сборка `req.auth` — ОДНА на все способы удостоверения.
 *
 * Способов теперь два: серверный сеанс better-auth (`middleware/attachSession`)
 * и телеграм-актор (`middleware/attachTelegramActor` через
 * `services/telegramActor`). Форма `req.auth` при этом обязана совпадать до
 * поля: её читают ~52 маршрута через
 * `req.userId` и все гейты прав через `can()`. Разойдись эти две сборки — и
 * контроллер, работающий из браузера, молча повёл бы себя иначе из бота.
 *
 * Ровно этот класс расхождения и разбирается сейчас в телеграм-боте: у него
 * своя копия модели пользователя, которая отстала от `isActive` → `banned` и от
 * переезда прав на роли. Второй копии правил доступа не заводим.
 */

/**
 * Основания отказать, общие для всех способов входа.
 *
 * `company.isActive` остаётся отдельной проверкой: у better-auth нет понятия
 * «организация отключила сотрудника», это прикладное правило (см. комментарий в
 * `middleware/attachSession`).
 *
 * `banned` читается через `isBanned`, а не напрямую: отключение со сроком после
 * срока не действует (см. `services/authBan`).
 */
const isDeniedAccount = (user) =>
  Boolean(
    isBanned(user) || user.company?.isActive === false || user.isServiceAccount,
  );

/**
 * Права разрешаются ОДИН РАЗ на запрос: штатный `hasPermission` плагина ходит в
 * базу за всеми ролями организации при каждом вызове, а проверок на запрос
 * бывает несколько. Само решение принимает всё равно функция better-auth
 * (`authorizeFor`), своей логики прав у нас нет.
 *
 * @param {object} user документ пользователя (Mongoose)
 * @param {object|null} session сеанс better-auth; у телеграм-актора его нет
 */
const buildAuthContext = async (user, session = null) => {
  const { statements, grantStatements } = await effectivePermissions(user);
  // Тем же правилом, что и `effectivePermissions`: `isAdmin` у клиентской
  // учётной записи не действует — иначе оставшийся в базе флаг обходил бы
  // скоупы заявок и отчётов (`req.auth.isAdmin` читают десятки мест).
  const isAdmin = isStaffAdmin(user);

  return {
    userId: user._id.toString(),
    user,
    statements,
    /**
     * `can({ ticket: ["delete"] })` — тот же запрос, что понимает плагин.
     *
     * Замыкания на `isAdmin` здесь БОЛЬШЕ НЕТ: администратору весь словарь
     * выдаёт `effectivePermissions`, поэтому ответ функции и содержимое
     * `statements` совпадают всегда. Пока замыкание стояло здесь, они
     * расходились — и всё, что читало набор напрямую, отказывало
     * администратору там, где `can()` пускал.
     */
    can: authorizeFor(statements),
    grantStatements,
    /** Что этот человек вправе выдать роли — до вырезания по типу аккаунта. */
    canGrant: authorizeFor(grantStatements),
    isAdmin,
    isEndUser: user.isEndUser !== false,
    session,
    // Прежняя плоская форма ответа снятого шима `getAuthData`: тот же
    // объект пользователя плюс userId.
    legacy: { ...user.toObject(), userId: user._id.toString() },
  };
};

module.exports = { buildAuthContext, isDeniedAccount };

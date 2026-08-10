const { effectivePermissions } = require("@/services/permissions");
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
 */
const isDeniedAccount = (user) =>
  Boolean(
    user.banned || user.company?.isActive === false || user.isServiceAccount,
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
  const { statements, permissions } = await effectivePermissions(user);
  const isAdmin = Boolean(user.isAdmin);

  return {
    userId: user._id.toString(),
    user,
    permissions,
    statements,
    /**
     * `can({ ticket: ["delete"] })` — тот же запрос, что понимает плагин.
     * Администратор проходит везде: это не право, а признак учётной записи.
     */
    can: (request) => isAdmin || authorizeFor(statements)(request),
    isAdmin,
    isEndUser: user.isEndUser !== false,
    session,
    // Прежняя плоская форма ответа снятого шима `getAuthData`: тот же
    // объект пользователя плюс userId. Отличие одно — permissions здесь
    // ЭФФЕКТИВНЫЕ и всегда полные.
    legacy: { ...user.toObject(), userId: user._id.toString(), permissions },
  };
};

module.exports = { buildAuthContext, isDeniedAccount };

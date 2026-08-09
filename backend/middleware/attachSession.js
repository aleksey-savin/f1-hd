const User = require("@/models/user");
const { getAuth, getFromNodeHeaders } = require("@/auth/bootstrap");
const { effectivePermissions } = require("@/services/permissions");
const { authorizeFor } = require("@/auth/bootstrap");
const { revokeById } = require("@/services/authSessions");
const { SESSION_MAX_MS } = require("@/services/impersonation");

/**
 * Единственное место, где решается «кто это». Ставится ОДИН РАЗ на весь /api и
 * наполняет `req.auth`. Ничего не запрещает: отказы выдают `requireAuth` и
 * гейты прав, читающие уже готовый результат.
 *
 * Заменяет связку `isAuth` + `getAuthData`. Раньше один запрос делал до четырёх
 * чтений `users`: `isAuth`, гейт модуля, гейт права и сам контроллер — каждый
 * заново поднимал пользователя.
 */

/** Серверная сессия better-auth — cookie или bearer. */
const identifyBySession = async (req) => {
  const session = await getAuth().api.getSession({
    headers: getFromNodeHeaders()(req.headers),
  });
  return session?.user?.id
    ? { userId: String(session.user.id), session: session.session || null }
    : null;
};

module.exports = async (req, res, next) => {
  try {
    const identity = await identifyBySession(req);

    if (!identity) {
      return next();
    }

    const user = await User.findById(identity.userId);
    if (!user) {
      return next();
    }

    /**
     * СРОК СЕАНСА ПОДМЕНЫ СЧИТАЕМ САМИ, а не полагаемся на `expiresAt`.
     *
     * Почему не хватает `expiresAt` — в `services/impersonation.js`, там же
     * лежит и сама константа. Просроченный сеанс гасим: иначе он остался бы
     * висеть в списке устройств человека.
     */
    if (identity.session?.impersonatedBy) {
      const startedAt = new Date(identity.session.createdAt || 0).getTime();
      if (Date.now() - startedAt > SESSION_MAX_MS) {
        await revokeById(user._id, identity.session.id);
        return next();
      }
    }

    // Отключённая учётка, отключённая компания и служебный аккаунт не дают
    // доступа даже с валидным токеном — как и раньше в isAuth. Компания
    // остаётся отдельной проверкой: у better-auth нет понятия «организация
    // отключила сотрудника», это прикладное правило.
    if (user.banned || user.company?.isActive === false || user.isServiceAccount) {
      return next();
    }

    // Роли разрешаются ОДИН РАЗ на запрос: штатный hasPermission плагина ходит
    // в базу за всеми ролями организации при каждом вызове, а проверок на
    // запрос бывает несколько. Само решение принимает всё равно функция
    // better-auth (`authorizeFor`), своей логики прав у нас нет.
    const { statements, permissions } = await effectivePermissions(user);
    const isAdmin = Boolean(user.isAdmin);

    req.auth = {
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
      session: identity.session,
      // Форма, которую сорок раз ждёт код через getAuthData: тот же плоский
      // объект пользователя плюс userId. Отличие одно — permissions здесь
      // ЭФФЕКТИВНЫЕ и всегда полные.
      legacy: { ...user.toObject(), userId: user._id.toString(), permissions },
    };
    // ~52 маршрута читают req.userId напрямую — сохраняем.
    req.userId = req.auth.userId;

    next();
  } catch (error) {
    next(error);
  }
};

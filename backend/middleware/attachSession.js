const User = require("@/models/user");
const { getAuth, getFromNodeHeaders } = require("@/auth/bootstrap");
const { buildAuthContext, isDeniedAccount } = require("@/services/authContext");
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
    // доступа даже с валидным токеном — как и раньше в isAuth. Основания
    // отказа общие для всех способов входа и живут в services/authContext,
    // чтобы телеграм-актор не смог начать пускать тех, кого не пускает браузер.
    if (isDeniedAccount(user)) {
      return next();
    }

    req.auth = await buildAuthContext(user, identity.session);
    // ~52 маршрута читают req.userId напрямую — сохраняем.
    req.userId = req.auth.userId;

    next();
  } catch (error) {
    next(error);
  }
};

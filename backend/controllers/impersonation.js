const User = require("@/models/user");

const { AppError } = require("@/middleware/errorHandling");
const { getAuth, getFromNodeHeaders } = require("@/auth/bootstrap");
const {
  issue,
  claim,
  CODE_TTL_MS,
  SESSION_MAX_MS,
} = require("@/services/impersonation");
const authConfig = require("@/auth/config");

/**
 * Вход под пользователем.
 *
 * Отдаём ССЫЛКУ, а не подменяем текущую вкладку: администратор открывает её в
 * другом браузере или в инкогнито, и его собственная сессия всё это время
 * цела. Возвращаться поэтому неоткуда и не надо — «Выйти» в чужом браузере это
 * обычный выход, а штатный `stopImpersonating` мы не зовём вовсе (он ищет
 * спрятанную cookie, которой в том браузере никогда не было).
 */

/** Код уходит в ЯКОРЬ адреса: то, что после решётки, до сервера не доезжает. */
const linkFor = (code) =>
  `${String(authConfig.baseURL || "").replace(/\/+$/, "")}/impersonate#${code}`;

exports.start = async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) {
      return next(new AppError("Учётная запись не найдена", 404));
    }

    if (String(target._id) === String(req.auth.user._id)) {
      return next(new AppError("Под собой входить незачем", 400));
    }
    if (target.isServiceAccount) {
      return next(
        new AppError("Служебная учётная запись не входит в портал", 400),
      );
    }
    if (target.banned) {
      return next(new AppError("Учётная запись отключена", 400));
    }

    /**
     * ПОД АДМИНИСТРАТОРОМ ХОДИТЬ НЕЛЬЗЯ — иначе право «войти под пользователем»
     * означает «стать администратором».
     *
     * Плагин умеет это сам, но узнаёт администратора по своему полю
     * `user.role`, значение которого у нас означает совсем другое. Признак наш:
     * `isAdmin` — зеркало роли, отдающей весь словарь.
     */
    if (target.isAdmin) {
      return next(
        new AppError("Под администратором войти нельзя", 403),
      );
    }

    /**
     * Ключевая деталь: `asResponse: false` и заголовки ответа плагина В НАШ
     * ОТВЕТ НЕ ПЕРЕНОСЯТСЯ. Именно они гасили бы cookie администратора и
     * ставили чужую — то есть подменяли текущую вкладку.
     */
    const result = await getAuth().api.impersonateUser({
      body: { userId: String(target._id) },
      headers: getFromNodeHeaders()(req.headers),
      asResponse: false,
    });

    const sessionToken = result?.session?.token;
    if (!sessionToken) {
      return next(new AppError("Не удалось создать сеанс подмены", 500));
    }

    const { code, expiresAt } = await issue({
      sessionToken,
      targetId: target._id,
      adminId: req.auth.user._id,
    });

    res.status(200).json({
      link: linkFor(code),
      // Срок жизни ССЫЛКИ, а не сеанса: их путают, и в интерфейсе названы оба.
      linkExpiresAt: expiresAt,
      sessionExpiresAt: result.session.expiresAt,
      user: {
        _id: target._id,
        firstName: target.firstName,
        lastName: target.lastName,
      },
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    // Отказ плагина («не разрешено») приезжает своей ошибкой со статусом.
    const status = error?.statusCode || error?.status;
    if (status === 403 || status === "FORBIDDEN") {
      return next(new AppError("Подмена не разрешена", 403));
    }
    next(new AppError("Не удалось войти под пользователем", 500, true, error));
  }
};

/**
 * Обмен кода на сеанс. Без авторизации по определению: его открывают в чистом
 * браузере, где никакой сессии ещё нет. Защита — одноразовость, десять минут
 * жизни и лимитер на маршруте.
 */
exports.claim = async (req, res, next) => {
  try {
    const found = await claim(req.body?.code);
    if (!found) {
      return next(
        new AppError("Ссылка уже использована или истекла", 400),
      );
    }

    const user = await User.findById(found.targetId).select(
      "firstName lastName email isEndUser isAdmin",
    );

    res.status(200).json({
      token: found.sessionToken,
      userId: user?._id,
      // Не `session.expiresAt`: его better-auth продлевает, а настоящий предел
      // — час от начала подмены (см. services/impersonation.js).
      expiryDate: new Date(Date.now() + SESSION_MAX_MS),
      user,
      // Минуты жизни ссылки нужны интерфейсу, чтобы объяснить отказ.
      ttlMinutes: Math.round(CODE_TTL_MS / 60000),
    });
  } catch (error) {
    next(new AppError("Не удалось открыть сеанс", 500, true, error));
  }
};

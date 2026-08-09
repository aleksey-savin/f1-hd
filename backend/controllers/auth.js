const { AppError } = require("../middleware/errorHandling");

const User = require("../models/user");

const { getAuth, getFromNodeHeaders } = require("../auth/bootstrap");
// Проверка пароля без создания сеанса — там же, где и его запись: обе
// операции работают с credential-аккаунтом и обе обходят обёртки плагинов.
const { verifyUserPassword } = require("../services/authPassword");

/**
 * Создание сеанса с переносом заголовков better-auth на наш ответ.
 *
 * Ручка `/api/login` остаётся своей, а не заменяется на
 * `/api/auth/sign-in/email`, ради трёх вещей, которых библиотека не знает:
 * лимитер попыток (10 за 15 минут на пару адрес+IP), отдельное сообщение
 * «Учётная запись отключена» и запись `attemptedEmail` в журнал.
 */
const signInViaBetterAuth = async (req, res, email, password) => {
  const response = await getAuth().api.signInEmail({
    body: { email, password },
    headers: getFromNodeHeaders()(req.headers),
    asResponse: true,
  });

  if (!response.ok) {
    return null;
  }

  // getSetCookie отдаёт КАЖДУЮ куку отдельной строкой; конкатенация через
  // headers.get("set-cookie") склеила бы их в одну и сломала разбор в браузере.
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) {
    res.setHeader("Set-Cookie", cookies);
  }
  const bearer = response.headers.get("set-auth-token");
  if (bearer) {
    res.setHeader("set-auth-token", bearer);
    res.setHeader("Access-Control-Expose-Headers", "set-auth-token");
  }

  return response.json().catch(() => ({}));
};

exports.login = async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });

    // ПОРЯДОК ЗДЕСЬ ЗНАЧИМ. Сначала проверяем пароль, НЕ создавая сеанс, потом
    // применяем наши правила отказа, и только затем выдаём сеанс. Обратный
    // порядок оставлял отключённой учётке рабочую cookie при ответе 401.
    const isEqual = user ? await verifyUserPassword(user._id, password) : false;

    if (!user || user.isServiceAccount || !isEqual) {
      return next(
        // «логина» в приложении нет — входят почтой
        new AppError("Неверная почта или пароль.", 401, true, null, {
          attemptedEmail: email,
        }),
      );
    }

    // Статус 401, а не 403: форма входа показывает инлайн только сообщения со
    // статусами из своего списка, 403 уронит error boundary. Отключение
    // компании блокирует вход её сотрудников тем же текстом — статус компании
    // наружу не раскрываем.
    if (user.banned || user.company?.isActive === false) {
      return next(
        new AppError(
          "Учётная запись отключена. Обратитесь к администратору.",
          401,
          true,
          null,
          { attemptedEmail: email },
        ),
      );
    }

    // Все наши правила пройдены — только теперь создаём сеанс. До этой строки
    // ни одна cookie наружу не уходила и ни одной строки в authSessions не
    // появлялось.
    const issued = await signInViaBetterAuth(req, res, email, password);
    if (!issued) {
      return next(
        new AppError("Не удалось создать сеанс", 500, true, null, {
          attemptedEmail: email,
        }),
      );
    }

    user.lastLogin = new Date();
    await user.save();

    // Токен сеанса уехал заголовками Set-Cookie и set-auth-token. Тот же токен
    // кладём в поле `token` тела: ещё не мигрированный фронтенд положит его в
    // localStorage и будет слать как `Authorization: Bearer`, а плагин bearer
    // это принимает. Так старый клиент работает без единой правки, а переход
    // на куки превращается из условия переезда в уборку.
    res.status(200).json({
      token: res.getHeader("set-auth-token") || null,
      expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      userId: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      company: user.company,
      role: user.role,
      categories: user.categories,
      isAdmin: user.isAdmin,
      permissions: user.permissions,
      profileImagePath: user.profileImagePath,
    });
  } catch (error) {
    next(
      new AppError(`Login failed`, 500, true, error, {
        attemptedEmail: req.body.email,
      }),
    );
  }
};

/**
 * Привязка телеграм-чата к учётке. К авторизации отношения не имеет: вызывает
 * бот со своим общим секретом (middleware/isTelegramBot).
 */
exports.authTelegram = async (req, res, next) => {
  const { userId, chatId } = req.query;

  try {
    const user = await User.findById(userId);

    if (!user) {
      return next(new AppError("Пользователь не найден", 401));
    }

    user.telegramBot.isActive = true;
    user.telegramBot.chatId = chatId;

    await user.save();

    res.status(200).json({
      message: "Telegram-бот успешно подключен!",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to auth Telegram for user ${req.query.userId}`,
        500,
        true,
        error,
      ),
    );
  }
};

/**
 * ОДНА ДВЕРЬ для тех, кто не может войти: «Прислать письмо».
 *
 * Что именно уйдёт, решает сервер, а не человек:
 *   • клиенту — ССЫЛКА ДЛЯ ВХОДА (плагин magic-link). Из 98 заведённых за год
 *     клиентских учёток 76 не входили ни разу: учётка рождается из письма в
 *     поддержку, человек о ней не знает, а пароль ему генерировали и присылали
 *     открытым текстом. Ссылка даёт тот же уровень доверия, что и
 *     восстановление — доступ к почте есть доступ к учётке, — но паролями
 *     сорить перестаёт;
 *   • сотруднику — ССЫЛКА НА СМЕНУ ПАРОЛЯ. Вход по ссылке ему недоступен
 *     намеренно: у него пароль и (со временем) второй фактор, и письмо стало бы
 *     обходом двухфакторки. Пересечение «есть ссылка» и «есть TOTP» обязано
 *     остаться пустым — отсюда проверка `twoFactorEnabled` уже сейчас.
 *
 * Спрашивать человека, какое письмо ему нужно, было бы вопросом про устройство
 * системы: «вы клиент или сотрудник» — не его забота, а рядом стоящие «войти по
 * ссылке» и «получить пароль» читались бы как одно и то же.
 *
 * ГЕЙТ ЗДЕСЬ, А НЕ В ПЛАГИНЕ: `signInMagicLink` выписывает ссылку по любому
 * адресу и никого не проверяет.
 *
 * ОТВЕТ ВСЕГДА ОДИНАКОВЫЙ — и на успех, и на незнакомый адрес, и на отказ.
 * Ручка без авторизации, и разный ответ превратил бы её в проверялку чужих
 * адресов: ровно тем и было прежнее восстановление с его честным 404.
 */
exports.requestLoginLink = async (req, res, next) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  const same = () =>
    res.status(200).json({
      message: "Если такой адрес есть, письмо отправлено.",
    });

  try {
    if (!email) return same();

    const user = await User.findOne({ email }).select(
      "isEndUser banned isServiceAccount twoFactorEnabled company.isActive",
    );

    // Общие основания отказать: их не различает ни один из двух путей.
    const reachable =
      user &&
      !user.banned &&
      !user.isServiceAccount &&
      user.company?.isActive !== false;

    if (!reachable) return same();

    const headers = getFromNodeHeaders()(req.headers);
    const byLink = user.isEndUser !== false && !user.twoFactorEnabled;

    if (byLink) {
      await getAuth().api.signInMagicLink({
        body: { email, callbackURL: "/" },
        headers,
      });
    } else {
      await getAuth().api.requestPasswordReset({ body: { email }, headers });
    }

    return same();
  } catch (error) {
    // Сбой отправки тоже не должен различать адреса: наружу тот же ответ,
    // причина — в журнал.
    next(new AppError("Не удалось отправить письмо", 500, true, error));
  }
};

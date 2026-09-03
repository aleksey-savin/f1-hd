const { AppError } = require("../middleware/errorHandling");

const User = require("../models/user");

const { getAuth, getFromNodeHeaders } = require("../auth/bootstrap");
// Проверка пароля без создания сеанса — там же, где и его запись: обе
// операции работают с credential-аккаунтом и обе обходят обёртки плагинов.
const { verifyUserPassword } = require("../services/authPassword");
const { isBanned } = require("../services/authBan");
const { bindChat } = require("../services/telegramActor");

/**
 * Перенос заголовков сеанса из ответа better-auth на наш ответ.
 *
 * getSetCookie отдаёт КАЖДУЮ куку отдельной строкой; конкатенация через
 * headers.get("set-cookie") склеила бы их в одну и сломала разбор в браузере.
 *
 * @returns {string|null} токен сеанса из `set-auth-token`, если он был
 */
const forwardAuthHeaders = (response, res) => {
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) {
    res.setHeader("Set-Cookie", cookies);
  }
  const bearer = response.headers.get("set-auth-token");
  if (bearer) {
    res.setHeader("set-auth-token", bearer);
    res.setHeader("Access-Control-Expose-Headers", "set-auth-token");
  }
  return bearer || null;
};

/**
 * Ответ состоявшегося входа: одинаков у второго фактора и у кода из письма —
 * форма ждёт от любого последнего шага одно и то же (токен, срок, профиль).
 * Токен сеанса уже уехал заголовками; поле `token` — для ещё не мигрированных
 * экранов, которые шлют его как `Authorization: Bearer`.
 */
const sessionResponse = (res, user, token) =>
  res.status(200).json({
    token: token || null,
    expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    userId: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    isAdmin: user.isAdmin,
  });

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
    /**
     * Отказ ХУКА, а не ошибка сервера.
     *
     * Наши правила отказа живут в `databaseHooks.session.create.before`
     * (`auth/hooks.js#sessionRefusal`) — там же, где их видят все способы
     * входа. Оттуда они возвращаются обычным ответом с текстом, и потерять
     * этот текст нельзя: администратор, которому закрыли вход требованием
     * второго фактора, иначе увидит «Не удалось создать сеанс» и не поймёт
     * ничего.
     */
    const body = await response.json().catch(() => ({}));
    return { refused: body?.message || null };
  }

  forwardAuthHeaders(response, res);

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
    if (isBanned(user) || user.company?.isActive === false) {
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
    if (issued?.refused !== undefined) {
      // 401, а не 403: форма входа показывает инлайн только статусы из своего
      // списка, 403 уронил бы её в error boundary.
      return next(
        new AppError(
          issued.refused || "Не удалось создать сеанс",
          401,
          true,
          null,
          { attemptedEmail: email },
        ),
      );
    }

    /**
     * ВТОРОЙ ФАКТОР: верный пароль НЕ ЗАКАНЧИВАЕТСЯ СЕАНСОМ.
     *
     * Плагин `twoFactor` перехватывает вход после проверки пароля, удаляет
     * только что созданный сеанс и отвечает `{ twoFactorRedirect: true }`.
     * Токена в ответе нет вовсе — ни в теле, ни в заголовке.
     *
     * Ветка общая, поэтому необработанной она ломает вход ВСЕМ, а не только
     * тем, у кого фактор включён: форма положила бы в хранилище пустой токен и
     * ушла в приложение без сеанса. `lastLogin` здесь тоже не трогаем — человек
     * ещё не вошёл.
     *
     * Состояние проверки уехало подписанной cookie (её перенёс
     * `signInViaBetterAuth`), поэтому второй шаг ничего передавать не должен.
     */
    if (issued.twoFactorRedirect) {
      return res.status(200).json({
        twoFactorRequired: true,
        methods: issued.twoFactorMethods || ["totp"],
      });
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
 * Второй шаг входа: код из приложения или резервный код.
 *
 * Своя ручка поверх плагина по той же причине, что и `/api/login`: форма ждёт
 * один и тот же ответ (токен, срок, профиль) от обоих шагов, а `lastLogin`
 * ставится там, где вход действительно состоялся. Плюс лимитер: перебор
 * шестизначного кода — реальная атака, а не теоретическая.
 */
exports.verifyTwoFactor = async (req, res, next) => {
  const { code, backup } = req.body;

  try {
    /**
     * Через `auth.api`, а не через `auth.handler(new Request(...))`: собранный
     * руками запрос не проходит защиту от CSRF — better-auth требует заголовок
     * `Origin` на любом запросе с cookie и отвечает «Missing or null Origin».
     * Пробрасывать же заголовки исходного запроса целиком — то, что делают все
     * остальные наши обёртки над библиотекой.
     *
     * Cookie с состоянием проверки прислал браузер: без неё плагин не знает,
     * чей вход подтверждают.
     */
    const verify = backup
      ? getAuth().api.verifyBackupCode
      : getAuth().api.verifyTOTP;

    const response = await verify({
      body: { code: String(code || "") },
      headers: getFromNodeHeaders()(req.headers),
      asResponse: true,
    });

    if (!response.ok) {
      return next(
        new AppError(
          backup ? "Неверный резервный код" : "Неверный код",
          401,
          true,
        ),
      );
    }

    const bearer = forwardAuthHeaders(response, res);

    const body = await response.json().catch(() => ({}));
    const userId = body?.user?.id || body?.session?.userId;
    const user = userId ? await User.findById(userId) : null;
    if (!user) {
      return next(new AppError("Не удалось завершить вход", 500));
    }

    user.lastLogin = new Date();
    await user.save();

    sessionResponse(res, user, bearer);
  } catch (error) {
    next(new AppError("Не удалось завершить вход", 500, true, error));
  }
};

/**
 * Привязка телеграм-чата к учётке. К авторизации отношения не имеет: вызывает
 * бот со своим общим секретом (middleware/isTelegramBot).
 *
 * ПОЛЕЗНАЯ НАГРУЗКА `/start` — ОДНОРАЗОВЫЙ КОД, а не `user._id`. Почему именно
 * так — в `services/telegramPairing`: идентификатор пользователя не секрет и
 * приезжает в браузер в каждой заявке, так что прежняя схема позволяла привязать
 * свой телеграм к чужой учётке, зная один ObjectId.
 *
 * Имя параметра остаётся `userId`, пока бот не переписан: он шлёт содержимое
 * `/start` под этим именем и меняется отдельным релизом. Читаем оба.
 */
exports.authTelegram = async (req, res, next) => {
  try {
    const { chatId } = req.query;
    const code = req.query.code || req.query.userId;

    const result = await bindChat({ code, chatId });

    if (!result.ok) {
      // Формулировки разные, статус один: подсказывать снаружи, чем именно не
      // подошла попытка, незачем.
      const message =
        result.reason === "group-chat"
          ? "Бота подключают в личном чате, а не в группе"
          : result.reason === "denied"
            ? "Учётная запись отключена"
            : "Ссылка устарела. Откройте «Мой аккаунт → Интеграции» и нажмите «Подключить» ещё раз";
      return next(new AppError(message, 400));
    }

    res.status(200).json({
      message: "Telegram-бот успешно подключен!",
      firstName: result.user.firstName,
    });
  } catch (error) {
    next(new AppError("Не удалось подключить Telegram", 500, true, error));
  }
};

/**
 * ОДНА ДВЕРЬ для тех, кто не может войти: «Войти по коду из письма».
 *
 * Код получают все, но код разный, и решает это сервер, а не человек:
 *   • клиенту — КОД ДЛЯ ВХОДА (`sign-in`). Пароля у большинства клиентов
 *     никогда и не было — учётка рождается из письма в поддержку, — а ссылка
 *     открывается в том браузере, где прочитали почту; код вводят там, где
 *     входят. Доступ к почте даёт тот же уровень доверия, что и
 *     восстановление, но паролями сорить перестаёт. Клиенту с включённым
 *     вторым фактором после кода задают ещё и код из приложения — хук
 *     `twoFactorAfterEmailCode` в `auth/instance.mjs`;
 *   • сотруднику — КОД ДЛЯ СМЕНЫ ПАРОЛЯ (`forget-password`). Тот же экран,
 *     тот же ввод кода, но за ним экран нового пароля, а не сеанс: сотрудник
 *     входит паролем и вторым фактором, и вход по коду ему не положен. Код
 *     для входа ему не уходит даже через публичную ручку плагина
 *     (`auth/hooks.js#sendEmailCode`), а код смены пароля ручка входа не
 *     примет — идентификаторы у типов разные.
 *
 * Спрашивать человека, какое письмо ему нужно, было бы вопросом про устройство
 * системы: «вы клиент или сотрудник» — не его забота. До ввода кода экран для
 * всех один; расходятся только после него.
 *
 * ГЕЙТ ЗДЕСЬ, А НЕ В ПЛАГИНЕ: `sendVerificationOTP` шлёт по любому известному
 * адресу и не знает ни про отключённые учётки, ни про служебные, ни про
 * выключенные компании.
 *
 * ОТВЕТ ВСЕГДА ОДИНАКОВЫЙ — и на успех, и на незнакомый адрес, и на отказ.
 * Ручка без авторизации, и разный ответ превратил бы её в проверялку чужих
 * адресов: ровно тем и было прежнее восстановление с его честным 404.
 */
exports.requestLoginCode = async (req, res, next) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  const same = () =>
    res.status(200).json({
      message: "Если такой адрес есть, код отправлен.",
    });

  try {
    if (!email) return same();

    const user = await User.findOne({ email }).select(
      "isEndUser banned banExpires isServiceAccount company.isActive",
    );

    // Общие основания отказать: их не различает ни один из двух путей.
    const reachable =
      user &&
      !isBanned(user) &&
      !user.isServiceAccount &&
      user.company?.isActive !== false;

    if (!reachable) return same();

    await getAuth().api.sendVerificationOTP({
      body: {
        email,
        type: user.isEndUser !== false ? "sign-in" : "forget-password",
      },
      headers: getFromNodeHeaders()(req.headers),
    });

    return same();
  } catch (error) {
    // Письмо не ушло — говорим об этом прямо, а не «отправлено»: человек
    // ждёт у экрана. Да, пока почта сломана, ответ различает адреса — это
    // принятая цена честного экрана.
    next(
      new AppError("При отправке письма произошла ошибка", 500, true, error),
    );
  }
};

/** Отказы плагина — по коду, а не по английскому тексту. */
const LOGIN_CODE_FAILURES = {
  INVALID_OTP: "Неверный код",
  OTP_EXPIRED: "Код устарел. Запросите новый.",
  TOO_MANY_ATTEMPTS: "Слишком много попыток. Запросите новый код.",
};

/** Отказ плагина или нашего хука — в текст для плашки. */
const codeFailure = async (response) => {
  const body = await response.json().catch(() => ({}));
  // 403 без известного кода — отказ нашего хука с русским текстом; всё
  // остальное (валидация тела, неизвестный адрес) — «неверный код», чтобы
  // ручка не различала адреса.
  return (
    LOGIN_CODE_FAILURES[body?.code] ||
    (response.status === 403 && body?.message) ||
    LOGIN_CODE_FAILURES.INVALID_OTP
  );
};

/**
 * Проверка кода из письма: клиенту — сеанс, сотруднику — дорога к паролю.
 *
 * Своя ручка поверх плагина по той же причине, что и `/api/login`: форма ждёт
 * один и тот же ответ от любого последнего шага, `lastLogin` ставится там, где
 * вход состоялся, и лимитер по адресу — свой.
 *
 * Сотруднику код НЕ ГАСИТСЯ, а только проверяется (`checkVerificationOTP`):
 * он понадобится ещё раз, вместе с новым паролем, — и погасит его уже
 * `/api/login-code/password`. Ответ `passwordReset` говорит форме, что дальше
 * экран пароля. Что адрес принадлежит сотруднику, ответ раскрывает только
 * после верного кода — то есть тому, у кого есть почта.
 *
 * Правила отказа в сеансе (отключённая учётка, служебная, компания выключена,
 * обязательный фактор у администратора) применяет хук создания сеанса — тот
 * же, что у пароля. Его текст показываем как есть, как и в `/api/login`.
 */
exports.verifyLoginCode = async (req, res, next) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const otp = String(req.body?.otp || "").trim();

  try {
    if (!email || !otp) {
      return next(
        new AppError("Введите код из письма", 401, true, null, {
          attemptedEmail: email,
        }),
      );
    }

    const headers = getFromNodeHeaders()(req.headers);
    // Незнакомый адрес идёт дорогой клиента: там плагин сам ответит
    // «неверный код», и ручка не различит адреса.
    const account = await User.findOne({ email }).select("isEndUser").lean();
    const isClient = !account || account.isEndUser !== false;

    if (!isClient) {
      const check = await getAuth().api.checkVerificationOTP({
        body: { email, otp, type: "forget-password" },
        headers,
        asResponse: true,
      });
      if (!check.ok) {
        return next(
          new AppError(await codeFailure(check), 401, true, null, {
            attemptedEmail: email,
          }),
        );
      }
      return res.status(200).json({ passwordReset: true });
    }

    const response = await getAuth().api.signInEmailOTP({
      body: { email, otp },
      headers,
      asResponse: true,
    });

    if (!response.ok) {
      return next(
        new AppError(await codeFailure(response), 401, true, null, {
          attemptedEmail: email,
        }),
      );
    }

    const bearer = forwardAuthHeaders(response, res);
    const body = await response.json().catch(() => ({}));

    // Код принят, но у человека включён второй фактор: сеанса ещё нет, cookie
    // проверки уже уехала — дальше та же `/api/login/two-factor`.
    if (body.twoFactorRedirect) {
      return res.status(200).json({
        twoFactorRequired: true,
        methods: body.twoFactorMethods || ["totp"],
      });
    }

    const userId = body?.user?.id;
    const user = userId ? await User.findById(userId) : null;
    if (!user) {
      return next(new AppError("Не удалось завершить вход", 500));
    }

    user.lastLogin = new Date();
    await user.save();

    sessionResponse(res, user, bearer);
  } catch (error) {
    next(
      new AppError("Не удалось завершить вход", 500, true, error, {
        attemptedEmail: email,
      }),
    );
  }
};

const PASSWORD_FAILURES = {
  PASSWORD_TOO_SHORT: "Пароль слишком короткий",
  PASSWORD_TOO_LONG: "Пароль слишком длинный",
};

/**
 * Новый пароль по коду из письма — последний шаг сотрудника.
 *
 * Штатная ручка плагина: гасит код, пишет пароль (или заводит credential-
 * аккаунт, если пароля не было — приглашённый сотрудник) и вместе с
 * `revokeSessionsOnPasswordReset` гасит все сеансы, как и сброс по ссылке.
 * Проверка по спискам утечек — общий хук `checkBreachedPasswords`, путь
 * `/email-otp/reset-password` у него в списке. Сеанса здесь нет намеренно:
 * дальше сотрудник входит паролем и вторым фактором.
 */
exports.resetPasswordByCode = async (req, res, next) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const otp = String(req.body?.otp || "").trim();
  const password = String(req.body?.password || "");

  try {
    if (!email || !otp) {
      return next(
        new AppError("Введите код из письма", 401, true, null, {
          attemptedEmail: email,
        }),
      );
    }
    if (!password) {
      return next(new AppError("Введите пароль", 400));
    }

    /**
     * Отказ приходит в двух видах. Сама ручка отвечает Response, а хук
     * `before` (проверка пароля по утечкам) БРОСАЕТ `APIError` даже при
     * `asResponse` — до ручки дело не доходит. Сводим к одному виду, иначе
     * вердикт «пароль встречается в утечках» превращался бы в 500.
     */
    let response;
    try {
      response = await getAuth().api.resetPasswordEmailOTP({
        body: { email, otp, password },
        headers: getFromNodeHeaders()(req.headers),
        asResponse: true,
      });
    } catch (error) {
      if (!error?.body && !error?.statusCode) throw error;
      response = {
        ok: false,
        status: error.statusCode || 400,
        json: async () => error.body || { message: error.message },
      };
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body?.code;
      if (LOGIN_CODE_FAILURES[code]) {
        return next(
          new AppError(LOGIN_CODE_FAILURES[code], 401, true, null, {
            attemptedEmail: email,
          }),
        );
      }
      // Вердикт по утечкам приходит нашим текстом от хука; остальное —
      // редкие ошибки плагина, как и у сброса по ссылке.
      return next(
        new AppError(
          PASSWORD_FAILURES[code] || body?.message || "Не удалось сменить пароль",
          400,
          true,
          null,
          { attemptedEmail: email },
        ),
      );
    }

    res.status(200).json({ message: "Пароль изменён" });
  } catch (error) {
    next(
      new AppError("Не удалось сменить пароль", 500, true, error, {
        attemptedEmail: email,
      }),
    );
  }
};

const { AppError } = require("../middleware/errorHandling");

const User = require("../models/user");

const { getAuth, getFromNodeHeaders } = require("../auth/bootstrap");
// Проверка пароля без создания сеанса — там же, где и его запись: обе
// операции работают с credential-аккаунтом и обе обходят обёртки плагинов.
const { verifyUserPassword } = require("../services/authPassword");
const { isBanned } = require("../services/authBan");
const { bindChat } = require("../services/telegramActor");

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

    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) {
      res.setHeader("Set-Cookie", cookies);
    }
    const bearer = response.headers.get("set-auth-token");
    if (bearer) {
      res.setHeader("set-auth-token", bearer);
      res.setHeader("Access-Control-Expose-Headers", "set-auth-token");
    }

    const body = await response.json().catch(() => ({}));
    const userId = body?.user?.id || body?.session?.userId;
    const user = userId ? await User.findById(userId) : null;
    if (!user) {
      return next(new AppError("Не удалось завершить вход", 500));
    }

    user.lastLogin = new Date();
    await user.save();

    res.status(200).json({
      token: bearer || null,
      expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      userId: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      isAdmin: user.isAdmin,
    });
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
      "isEndUser banned banExpires isServiceAccount twoFactorEnabled company.isActive",
    );

    // Общие основания отказать: их не различает ни один из двух путей.
    const reachable =
      user &&
      !isBanned(user) &&
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

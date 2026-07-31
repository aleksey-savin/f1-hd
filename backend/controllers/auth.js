const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { AppError } = require("../middleware/errorHandling");

const User = require("../models/user");
const Company = require("../models/company");
const Preferences = require("../models/preferences");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SESSION_DAYS = 14;

/**
 * Сеанс для только что заведённого пользователя (регистрация, первый запуск).
 * В полезной нагрузке один `userId` — этого хватает `isAuth`, а профиль клиент
 * всё равно перечитывает загрузчиком корня. Полный набор клеймов остаётся у
 * `login`, где он исторически сложился.
 */
const issueSession = (user) => ({
  token: jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, {
    expiresIn: `${SESSION_DAYS}d`,
    issuer: "helpdesk-api",
    audience: "web-client",
    notBefore: 0,
  }),
  expiryDate: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  userId: user._id,
});

/**
 * Компания по домену рабочей почты. Домены вводит администратор руками, и
 * регистр им никто не нормализует, поэтому сравниваем без учёта регистра:
 * иначе подсказка формы и сама регистрация разойдутся на `F1Lab.ru`.
 * Отключённая компания не опознаётся — саморегистрация к ней не привяжет.
 */
const findCompanyByEmailDomain = (email) => {
  const domain = String(email || "").split("@")[1];
  if (!domain) {
    return null;
  }
  return Company.findOne({
    emailDomains: {
      $elemMatch: { $regex: `^${escapeRegex(domain)}$`, $options: "i" },
    },
    isActive: { $ne: false },
  });
};

/**
 * Узнавание компании по адресу — то же правило, по которому привязывает
 * `signup`, но ДО сабмита: иначе человек заполняет пять полей и получает 404
 * «не можем понять из какой Вы компании».
 *
 * Ответ намеренно беден: название компании и два флага, без имён и id. Факт
 * существования учётки приложение и так проговаривает (409 на регистрации,
 * 404 на восстановлении), новой возможности эта ручка не даёт — зато уводит
 * человека с готовой учёткой туда, где ему помогут («Получить пароль»).
 */
exports.companyByEmail = async (req, res, next) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const [company, registered] = await Promise.all([
      findCompanyByEmailDomain(email),
      User.exists({ email }),
    ]);

    return res.status(200).json({
      status: company ? "known" : "unknown",
      company: company ? { title: company.alias || company.fullTitle } : null,
      registered: Boolean(registered),
    });
  } catch (error) {
    next(new AppError("Failed to resolve company by email", 500, true, error));
  }
};

exports.signup = async (req, res, next) => {
  // Адрес приводим к нижнему регистру ДО поисков: сохраняется он тоже
  // lowercase, а поиск по сырому вводу пропускал дубль мимо проверки 409
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();
  const company = await findCompanyByEmailDomain(email);
  const userExists = await User.findOne({ email });

  if (userExists) {
    return next(
      new AppError("Пользователь с таким email уже зарегистрирован.", 409),
    );
  }

  const usersCount = await User.countDocuments();

  if (!company && usersCount > 0) {
    return next(
      new AppError(
        "Мы не можем понять из какой Вы компании :( Пожалуйста, укажите рабочий email и попробуйте снова.",
        404,
      ),
    );
  }

  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 12);

    const user = new User({
      email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      password: hashedPassword,
      position: "",
      phone: "",
      isAdmin: false,
      isEndUser: true,
      company: company,
      isActive: true,
      lastLogin: new Date(),
    });
    await user.save();

    res.status(201).json(issueSession(user));
  } catch (error) {
    next(new AppError("Failed to signup user", 500, true, error));
  }
};

exports.login = async (req, res, next) => {
  const { email, password } = req.body;
  let loadedUser;

  const user = await User.findOne({ email: email.toLowerCase() });

  loadedUser = user;

  try {
    let isEqual = false;

    if (user) {
      isEqual = await bcrypt.compare(password, user.password);
    }

    if (!user || user.isServiceAccount || !isEqual) {
      return next(
        // «логина» в приложении нет — входят почтой
        new AppError("Неверная почта или пароль.", 401, true, null, {
          attemptedEmail: email,
        }),
      );
    }

    // Статус 401, а не 403: форма логина показывает инлайн только сообщения
    // со статусами из своего списка (Authentication.jsx), 403 уронит error boundary.
    // Отключение компании блокирует вход её пользователей тем же текстом —
    // статус компании наружу не раскрываем.
    if (!user.isActive || user.company?.isActive === false) {
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

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      {
        userId: loadedUser._id.toString(),
        firstName: loadedUser.firstName,
        lastName: loadedUser.lastName,
        email: loadedUser.email,
        phone: loadedUser.phone,
        company: loadedUser.company,
        role: loadedUser.role,
        isAdmin: loadedUser.isAdmin,
        isEndUser: loadedUser.isEndUser,
        permissions: loadedUser.permissions,
        companies: loadedUser.companies,
        categories: loadedUser.categories,
        profileImagePath: loadedUser.profileImagePath,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "14d",
        issuer: "helpdesk-api",
        audience: "web-client",
        notBefore: 0,
      },
    );

    res.status(200).json({
      token: token,
      expiryDate: new Date(new Date().getTime() + 14 * 24 * 60 * 60 * 1000),
      userId: loadedUser._id,
      firstName: loadedUser.firstName,
      lastName: loadedUser.lastName,
      email: loadedUser.email,
      phone: loadedUser.phone,
      company: loadedUser.company,
      role: loadedUser.role,
      categories: loadedUser.categories,
      isAdmin: loadedUser.isAdmin,
      permissions: loadedUser.permissions,
      companies: loadedUser.companies,
      profileImagePath: loadedUser.profileImagePath,
    });
  } catch (error) {
    next(
      new AppError(`Login failed`, 500, true, error, {
        attemptedEmail: req.body.email,
      }),
    );
  }
};

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
        `Failed to auth Telegram for user ${req.body.userId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });

    if (!user) {
      // return обязателен: без него код шёл дальше и падал на user.resetToken,
      // превращая честный 404 в 500
      return next(
        new AppError(
          "Пользователь с указанным E-Mail адресом не найден.",
          404,
          true,
        ),
      );
    }

    const resetToken = crypto.randomBytes(32).toString("hex");

    const plainToken = resetToken;
    const hashedToken = crypto
      .createHash("sha256")
      .update(plainToken)
      .digest("hex");

    user.resetToken = hashedToken;
    user.resetTokenExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    user.notifications = {
      lastAction: "forgot-password",
      resetToken: plainToken,
      pending: true,
    };

    await user.save();

    return res.status(201).json({
      emailSent: true,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to reset password for user ${req.body.userId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.validateResetToken = async (req, res, next) => {
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await User.findOne({
      resetToken: hashedToken,
      resetTokenExpiration: { $gt: Date.now() },
    });

    if (!user) {
      return next(
        new AppError(
          "Ссылка для восстановления пароля недействительна или истекла",
          400,
        ),
      );
    }

    res.status(200).json({
      message: "Токен действителен",
    });
  } catch (error) {
    next(new AppError(`Failed to validate reset token`, 500, true, error));
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.body.token)
      .digest("hex");

    const user = await User.findOne({
      resetToken: hashedToken,
      resetTokenExpiration: { $gt: Date.now() },
    });

    if (!user) {
      return next(
        new AppError(
          "Ссылка для восстановления пароля недействительна или истекла",
          400,
        ),
      );
    }

    // Validate password
    if (req.body.password.length < 6) {
      return next(new AppError("Минимальная длина пароля - 6 символов", 400));
    }

    // Hash new password and save
    const hashedPassword = await bcrypt.hash(req.body.password, 12);
    user.password = hashedPassword;
    user.resetToken = undefined;
    user.resetTokenExpiration = undefined;
    await user.save();

    res.status(200).json({
      message: "Пароль успешно изменен",
    });
  } catch (error) {
    next(new AppError("Failed to reset password", 500, true, error));
  }
};

exports.firstLaunch = async (req, res, next) => {
  const {
    companyFullTitle,
    userEmail,
    userFirstName,
    userLastName,
    userPassword,
  } = req.body;

  try {
    // Ручка неавторизованная — она и не может быть иной — поэтому единственное,
    // что отделяет её от создания администратора на живой базе, это счётчик
    // пользователей. Без него POST извне заводил в проде учётку с
    // canManageUsers/canManageCompanies/canAdministrateTickets.
    if ((await User.countDocuments()) > 0) {
      return next(new AppError("Первичная настройка уже выполнена.", 409));
    }

    // Поля-двойника у формы больше нет: его работу делает кнопка показа
    // пароля, а страховкой остаётся восстановление по почте
    const hashedPassword = await bcrypt.hash(userPassword, 12);

    const user = new User({
      email: userEmail,
      firstName: userFirstName,
      lastName: userLastName,
      password: hashedPassword,
      isAdmin: true,
      isEndUser: false,
      permissions: {
        canManageUsers: true,
        canManageCompanies: true,
        canAdministrateTickets: true,
      },
      isActive: true,
    });

    await user.save();

    const company = new Company({
      alias: companyFullTitle,
      fullTitle: companyFullTitle,
      users: [user],
      responsibles: [user],
      createdBy: user,
      updatedBy: user,
    });
    await company.save();

    user.company = company;
    user.responsibleForCompanies = [company];
    await user.save();

    const preferences = new Preferences({});
    await preferences.save();

    // Отдаём сеанс: человек ввёл этот пароль полминуты назад, и отправлять его
    // обратно на форму входа — тупик, который выглядит как «пароль не подошёл»
    res.status(201).json({
      message: "Созданы новый пользователь и компания.",
      company: company._id,
      ...issueSession(user),
    });
  } catch (error) {
    next(new AppError("First launch failed", 500, true, error));
  }
};

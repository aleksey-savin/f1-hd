const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { AppError } = require("../middleware/errorHandling");

const User = require("../models/user");
const Company = require("../models/company");
const Preferences = require("../models/preferences");

exports.signup = async (req, res, next) => {
  const emailDomain = req.body.email.replace(/.*@/, "");
  const company = await Company.findOne({
    emailDomains: { $in: [emailDomain] },
  });
  const userExists = await User.findOne({ email: req.body.email });

  if (userExists) {
    return next(
      new AppError("Пользователь с таким email уже зарегистрирован.", 409),
    );
  }

  const users = await User.find({});

  if (!company && users.length > 0) {
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
      email: req.body.email.toLowerCase(),
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

    const token = jwt.sign(
      {
        userId: user._id.toString(),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "14d",
        issuer: "helpdesk-api",
        audience: "web-client",
        notBefore: 0,
      },
    );

    res.status(201).json({
      token: token,
      expiryDate: new Date(new Date().getTime() + 14 * 24 * 60 * 60 * 1000),
      userId: user._id,
    });
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
        new AppError("Неверный логин или пароль", 401, true, null, {
          attemptedEmail: email,
        }),
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
        dashboard: loadedUser.dashboard,
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
      dashboard: loadedUser.dashboard,
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
      next(
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
    userPasswordRepeat,
  } = req.body;

  try {
    if (userPassword !== userPasswordRepeat) {
      next(new AppError("Failed to fetch opened tickets", 500));
      return res.status(400).json({
        error: 400,
        message: "Пароли не совпадают.",
      });
    }
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

    res.status(201).json({
      message: "Созданы новый пользователь и компания.",
      user: user._id,
      company: company._id,
    });
  } catch (error) {
    next(new AppError("First launch failed", 500, true, error));
  }
};

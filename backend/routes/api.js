const Router = require("express");
const router = new Router();
const isAuthApiKey = require("../middleware/isAuthApiKey");
const { AppError } = require("../middleware/errorHandling");
const CompanyLog = require("../models/companyLog");

/**
 * Получение информации о компании по API-ключу
 */
router.get("/company/info", isAuthApiKey, async (req, res, next) => {
  try {
    const { company } = req;

    res.status(200).json({
      success: true,
      data: {
        id: company._id,
        alias: company.alias,
        fullTitle: company.fullTitle,
        apiKey: {
          name: company.apiKey.name,
          createdAt: company.apiKey.createdAt,
        },
      },
    });
  } catch (error) {
    next(
      new AppError("Ошибка получения информации о компании", 500, true, error),
    );
  }
});

/**
 * Проверка валидности API-ключа
 */
router.get("/validate", isAuthApiKey, async (req, res, next) => {
  try {
    const { company } = req;

    res.status(200).json({
      success: true,
      message: "API-ключ действителен",
      data: {
        company: {
          id: company._id,
          alias: company.alias,
        },
        apiKey: {
          name: company.apiKey.name,
        },
      },
    });
  } catch (error) {
    next(new AppError("Ошибка валидации API-ключа", 500, true, error));
  }
});

/**
 * Запись лога активности пользователя (например, вход в систему)
 */
router.post("/log/user-activity", isAuthApiKey, async (req, res, next) => {
  try {
    const { company } = req;
    const {
      firstName,
      lastName,
      activeDirectoryObjectGUID,
      activeDirectoryLogin,
      computerName,
      action = "userLogin",
      timeStamp,
    } = req.body;

    // Валидация обязательных полей
    if (
      !firstName ||
      !lastName ||
      !activeDirectoryObjectGUID ||
      !activeDirectoryLogin
    ) {
      return next(
        new AppError(
          "Отсутствуют обязательные поля: firstName, lastName, activeDirectoryObjectGUID, activeDirectoryLogin",
          400,
        ),
      );
    }

    // Ищем пользователя по GUID Active Directory
    const User = require("../models/user");
    const linkedUser = await User.findOne({
      activeDirectoryObjectGUID: activeDirectoryObjectGUID.trim(),
    });

    // Создаем запись лога
    const logEntry = new CompanyLog({
      companyId: company._id,
      userId: linkedUser ? linkedUser._id : null,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      activeDirectoryObjectGUID: activeDirectoryObjectGUID.trim(),
      activeDirectoryLogin: activeDirectoryLogin.trim(),
      computerName: computerName ? computerName.trim() : undefined,
      action,
      timeStamp: timeStamp ? new Date(timeStamp) : new Date(),
    });

    await logEntry.save();

    res.status(201).json({
      success: true,
      message: "Лог активности пользователя записан",
      data: {
        id: logEntry._id,
        timeStamp: logEntry.timeStamp,
        action: logEntry.action,
        user: {
          firstName: logEntry.firstName,
          lastName: logEntry.lastName,
          activeDirectoryLogin: logEntry.activeDirectoryLogin,
        },
        linkedUser: linkedUser
          ? {
              id: linkedUser._id,
              firstName: linkedUser.firstName,
              lastName: linkedUser.lastName,
              email: linkedUser.email,
            }
          : null,
      },
    });
  } catch (error) {
    next(new AppError("Ошибка записи лога активности", 500, true, error));
  }
});

/**
 * Получение статистики по логам (для мониторинга)
 */
router.get("/logs/statistics", isAuthApiKey, async (req, res, next) => {
  try {
    const { getLogsStatistics } = require("../middleware/cleanupLogs");
    const statistics = await getLogsStatistics();

    res.status(200).json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    next(new AppError("Ошибка получения статистики логов", 500, true, error));
  }
});

module.exports = router;

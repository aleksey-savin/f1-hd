const User = require("@/models/user");
const CompanyLog = require("@/models/companyLog");
const { AppError } = require("@/middleware/errorHandling");
const {
  asString,
  companyLogLinkedUser,
  resolveCompanyLogUser,
} = require("@/services/externalApi");

/**
 * Вход в домен от AD-агента клиента (ключ компании). Человек связывается
 * только внутри компании ключа (services/externalApi): чужой GUID или адрес
 * не связывается и в ответе не называется.
 */
exports.addUserActivity = async (req, res, next) => {
  try {
    const { company } = req;
    const { firstName, lastName, email, action = "userLogin" } = req.body;
    // Строками: объект из тела ни в фильтр, ни в запись не попадает
    const activeDirectoryObjectGUID = asString(
      req.body.activeDirectoryObjectGUID,
    );
    const activeDirectoryLogin = asString(req.body.activeDirectoryLogin);
    const computerName = asString(req.body.computerName);

    if (!activeDirectoryObjectGUID || !activeDirectoryLogin) {
      return next(
        new AppError(
          "Отсутствуют обязательные поля: activeDirectoryObjectGUID, activeDirectoryLogin",
          400,
        ),
      );
    }

    // Сначала по GUID, потом по почте — оба раза в компании ключа
    const linkedUser = await resolveCompanyLogUser(
      { companyId: company._id, activeDirectoryObjectGUID, email },
      {
        findUser: (filter) =>
          User.findOne(filter).select("firstName lastName"),
      },
    );

    // Создаем запись лога
    const logEntry = new CompanyLog({
      companyId: company._id,
      userId: linkedUser ? linkedUser._id : null,
      activeDirectoryObjectGUID,
      activeDirectoryLogin,
      firstName: firstName ? String(firstName).trim() : undefined,
      lastName: lastName ? String(lastName).trim() : undefined,
      computerName: computerName || undefined,
      action,
    });

    await logEntry.save();

    res.status(201).json({
      success: true,
      message: "Лог активности пользователя записан",
      data: {
        id: logEntry._id,
        action: logEntry.action,
        user: {
          activeDirectoryLogin: logEntry.activeDirectoryLogin,
        },
        linkedUser: companyLogLinkedUser(linkedUser),
      },
    });
  } catch (error) {
    next(new AppError("Ошибка записи лога активности", 500, true, error));
  }
};

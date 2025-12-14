const { User } = require("../../models/user");
const { CompanyLog } = require("../../models/companyLog");
const { AppError } = require("../../middleware/errorHandling");

exports.addUserActivity = async (req, res, next) => {
  try {
    const { company } = req;
    const {
      activeDirectoryObjectGUID,
      activeDirectoryLogin,
      computerName,
      email,
      action = "userLogin",
    } = req.body;

    if (!activeDirectoryObjectGUID || !activeDirectoryLogin) {
      return next(
        new AppError(
          "Отсутствуют обязательные поля: activeDirectoryObjectGUID, activeDirectoryLogin",
          400,
        ),
      );
    }

    let linkedUser = await User.findOne({
      activeDirectoryObjectGUID: activeDirectoryObjectGUID.trim(),
    });

    // If email is provided and no user found by GUID, try to find by email
    if (!linkedUser && email) {
      linkedUser = await User.findOne({
        email: email.trim(),
      });
    }

    // Создаем запись лога
    const logEntry = new CompanyLog({
      companyId: company._id,
      userId: linkedUser ? linkedUser._id : null,
      activeDirectoryObjectGUID: activeDirectoryObjectGUID.trim(),
      activeDirectoryLogin: activeDirectoryLogin.trim(),
      computerName: computerName ? computerName.trim() : undefined,
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
};

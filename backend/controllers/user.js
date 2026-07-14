const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const storage = require("../services/storage");

const getAuthData = require("../middleware/getAuthData");
const { AppError } = require("../middleware/errorHandling");
const { concatIdsArray } = require("../helpers/concatIdsArray");

const User = require("../models/user");
const {
  WORK_STATUS_CODES,
  WORK_STATUS_BY_CODE,
} = require("../utils/workStatuses");
const Company = require("../models/company");
const Subdivision = require("../models/subdivision");
const TicketCategory = require("../models/ticketCategory");
const Prefs = require("../models/preferences");
const Location = require("../models/inventory/location");
const CompanyLog = require("../models/companyLog");
const { Ticket } = require("../models/ticket");

// Финансовые поля пользователя (оклад, ставка переработок)
const toNonNegativeOrNull = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
};

const canManageFinances = (caller) =>
  Boolean(caller.isAdmin || caller.permissions?.canSeeGlobalFinancialReport);

exports.getAll = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const authedUser = await User.findById(userId);

    // When the "only active" toggle is on, the frontend asks for active users
    // only — inactive accounts are not loaded until the toggle is turned off.
    const query = req.query.activeOnly === "true" ? { isActive: true } : {};
    const allUsers = await User.find(query).sort({ lastName: 1 });

    const filteredUsers = allUsers.filter((user) => {
      if (
        authedUser.responsibleForCompanies
          .map((company) => company._id.toString())
          .includes(user.company._id.toString()) ||
        authedUser.permissions.canAdministrateTickets ||
        authedUser.isAdmin
      ) {
        return user;
      }
    });

    // Last activity = latest ticket created by each user. One aggregation finds
    // the newest ticket per applicant instead of querying per user (same pattern
    // as company.js employee lastActivity).
    const userIds = filteredUsers.map((user) => user._id);

    const latestTickets = await Ticket.aggregate([
      {
        $match: {
          $or: [
            { applicantId: { $in: userIds } },
            { "applicant._id": { $in: userIds } },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $ifNull: ["$applicantId", "$applicant._id"] },
          createdAt: { $first: "$createdAt" },
          num: { $first: "$num" },
          title: { $first: "$title" },
        },
      },
    ]);

    const lastActivityByUser = new Map(
      latestTickets.map((ticket) => [ticket._id.toString(), ticket]),
    );

    const reducedUsers = filteredUsers.map((user) => {
      const lastTicket = lastActivityByUser.get(user._id.toString());
      return {
        _id: user._id,
        lastName: user.lastName,
        firstName: user.firstName,
        profileImagePath: user.profileImagePath,
        company: { _id: user.company._id, alias: user.company.alias },
        role: user.role,
        position: user.position,
        email: user.email,
        phone: user.phone,
        isServiceAccount: user.isServiceAccount,
        isAdmin: user.isAdmin,
        isEndUser: user.isEndUser,
        isCloudTelephony: user.isCloudTelephony,
        isActive: user.isActive,
        workStatus: user.workStatus,
        hideWorkStatus: user.hideWorkStatus,
        permissions: user.permissions,
        createdAt: user.createdAt,
        lastActivity: lastTicket
          ? {
              date: lastTicket.createdAt,
              ticketNum: lastTicket.num,
              ticketTitle: lastTicket.title,
            }
          : null,
      };
    });

    res.status(200).json({
      message: "Users fetched",
      users: reducedUsers,
    });
  } catch (error) {
    next(new AppError(`Failed to fetch users`, 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const { userId } = await await getAuthData(req);

    const authedUser = await User.findById(userId);

    const user = await User.findById(req.params.id)
      .select("-password -resetToken -resetTokenExpiration ")
      .populate({
        path: "subdivision",
        select: "_id name",
        populate: {
          path: "manager",
          select: "_id firstName lastName",
        },
      });

    if (!user) {
      return next(new AppError(`Failed to fetch user ${req.params.id}`, 404));
    }

    if (!authedUser.isEndUser) {
      const isSelf = authedUser._id.toString() === user._id.toString();
      if (canManageFinances(authedUser) || isSelf) {
        res.status(200).json(user);
      } else {
        // Оклад и ставка видны только самому сотруднику и фин. менеджерам
        const payload = user.toObject();
        delete payload.finances;
        res.status(200).json(payload);
      }
    } else {
      res.status(200).json(authedUser);
    }
  } catch (error) {
    next(
      new AppError(`Failed to fetch user ${req.params.id}`, 500, true, error),
    );
  }
};

exports.getAuthed = async (req, res, next) => {
  try {
    const authData = await getAuthData(req);
    const authedUser = await User.findById(authData.userId);
    if (!authedUser) {
      return next(new AppError(`Authed user not found`, 404));
    }
    res.status(200).json({
      message: "Auth data fetched",
      authedUser: authedUser,
    });
  } catch (error) {
    next(new AppError(`Failed to fetch authedUser`, 500, true, error));
  }
};

exports.getCanPerformTicketsUsers = async (req, res, next) => {
  try {
    const users = await User.find({
      "permissions.canPerformTickets": true,
      isActive: true,
    });
    res.status(200).json(users);
  } catch (error) {
    next(
      new AppError(`Failed to fetch CanPerformTicketsUsers`, 500, true, error),
    );
  }
};

// Кандидаты в модераторы базы знаний: активные сотрудники, которые могут видеть
// и управлять базой знаний (либо админы). Используется в настройках (вкладка
// «База знаний») для списка модераторов.
exports.getKnowledgeBaseModerators = async (req, res, next) => {
  try {
    const users = await User.find({
      isActive: true,
      isServiceAccount: false,
      $or: [
        {
          "permissions.canSeeKnowledgeBase": true,
          "permissions.canManageKnowledgeBase": true,
        },
        { isAdmin: true },
      ],
    })
      .sort({ lastName: 1 })
      .select("_id firstName lastName");

    res.status(200).json(users);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch knowledge base moderators`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.getUsersWithWorkplaces = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const authedUser = await User.findById(userId);

    // Получаем всех активных пользователей (отключённые в выборку не попадают)
    const allUsers = await User.find({ isActive: true }).sort({ lastName: 1 });

    // Фильтруем пользователей по правам доступа
    const filteredUsers = allUsers.filter((user) => {
      if (
        authedUser.responsibleForCompanies
          .map((company) => company._id.toString())
          .includes(user.company._id.toString()) ||
        authedUser.permissions.canAdministrateTickets ||
        authedUser.isAdmin
      ) {
        return user;
      }
    });

    // Получаем рабочие места для всех пользователей
    const userIds = filteredUsers.map((user) => user._id);
    const workplaces = await Location.find({
      type: "workplace",
      assignedUser: { $in: userIds },
      isActive: true,
    });

    // Создаем map для быстрого поиска рабочих мест
    const workplaceMap = {};
    workplaces.forEach((workplace) => {
      workplaceMap[workplace.assignedUser.toString()] = workplace;
    });

    // Формируем результат с информацией о рабочих местах
    const usersWithWorkplaces = filteredUsers.map((user) => {
      const workplace = workplaceMap[user._id.toString()];

      return {
        _id: user._id,
        lastName: user.lastName,
        firstName: user.firstName,
        fullName: `${user.firstName} ${user.lastName || ""}`.trim(),
        profileImagePath: user.profileImagePath,
        company: { _id: user.company._id, alias: user.company.alias },
        role: user.role,
        position: user.position,
        email: user.email,
        phone: user.phone,
        workplace: workplace
          ? {
              _id: workplace._id,
              name: workplace.name,
              description: workplace.description,
            }
          : null,
        isServiceAccount: user.isServiceAccount,
        isAdmin: user.isAdmin,
        isEndUser: user.isEndUser,
        createdAt: user.createdAt,
      };
    });

    res.status(200).json({
      message: "Users with workplaces fetched",
      users: usersWithWorkplaces,
    });
  } catch (error) {
    next(
      new AppError(`Failed to fetch users with workplaces`, 500, true, error),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    console.log("🚀 Создание нового пользователя. Данные запроса:", {
      body: req.body,
      userId: req.userId,
      headers: req.headers?.authorization ? "Present" : "Missing",
    });

    const {
      company: companyId,
      subdivision: subdivisionId,
      categories,
      email,
      password,
      sendPassword,
      phone,
      firstName,
      lastName,
      position,
      notify,
      role,
      isActive,
      isAdmin,
      isEndUser,
      isServiceAccount,
      isCloudTelephony,
      hideWorkStatus,
      permissions,
      dashboard,
      finances,
      getScreenApi,
    } = req.body;

    if (await User.findOne({ email: email })) {
      return next(
        new AppError(`Пользователь с адресом ${email} уже существует`, 409),
      );
    }

    const company = await Company.findById(companyId);
    const subdivision = subdivisionId
      ? await Subdivision.findById(subdivisionId)
      : null;

    let categoriesList = [];
    for (let id of categories) {
      let category = null;
      if (id) {
        category = await TicketCategory.findById(id);
      }

      if (category) {
        categoriesList.push(category);
      }
    }

    const plainPassword = password ? password : crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(plainPassword, 12);

    const user = new User({
      email: email?.toLowerCase(),
      phone: phone,
      firstName: firstName,
      lastName: lastName || "",
      position: position,
      company: company,
      subdivision: subdivision,
      categories: categoriesList,
      role: role,
      isAdmin: isAdmin,
      isEndUser: isEndUser,
      isServiceAccount: isServiceAccount,
      isCloudTelephony: isCloudTelephony,
      hideWorkStatus: !!hideWorkStatus,
      password: hashedPassword,
      isActive: isActive,
      getScreen: {
        api: getScreenApi || "",
      },
      permissions: permissions,
      dashboard: dashboard,
      notify: notify,
      notifications: {
        lastAction: "new user",
        password: jwt.sign(password, process.env.JWT_SECRET),
        pending: sendPassword,
      },
    });

    // Финансовые поля задают только админ или обладатель глобального фин. права
    const caller = await getAuthData(req);
    if (finances && canManageFinances(caller)) {
      user.finances = {
        salary: toNonNegativeOrNull(finances.salary),
        overtimeHourlyRate: toNonNegativeOrNull(finances.overtimeHourlyRate),
      };
    }

    await user.save();

    company.employees.push(user._id);

    await company.save();

    if (subdivision) {
      subdivision.users.push(user._id);
      await subdivision.save();
    }

    for (let category of user.categories) {
      const updatedCategory = await TicketCategory.findById(category._id);
      if (updatedCategory) {
        updatedCategory.users.push(user);
        await updatedCategory.save();
      }
    }

    try {
      const workplaceName =
        `Рабочее место - ${firstName} ${lastName || ""}`.trim();

      const workplace = new Location({
        name: workplaceName,
        type: "workplace",
        description: `Рабочее место сотрудника ${firstName} ${lastName || ""}`,
        company: company._id,
        subdivision: subdivision ? subdivision._id : null,
        assignedUser: user._id,
        defaultResponsible: user._id,
        isActive: true,
        isAccessible: true,
        securityLevel: "internal",
        createdBy: req.userId || user._id,
      });

      await workplace.save();
    } catch (workplaceError) {
      next(new AppError(`Failed to add workplace for user`, 500, true, error));
    }

    res.status(201).json({
      message: "Новый пользователь добавлен",
      userId: user._id,
    });
  } catch (error) {
    next(new AppError(`Failed to add new user`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    const prevCompany = await Company.findById(user.company._id);
    const newCompany = await Company.findById(req.body.company);
    const prevSubdivision = user.subdivision
      ? await Subdivision.findById(user.subdivision)
      : null;
    const newSubdivision = req.body.subdivision
      ? await Subdivision.findById(req.body.subdivision)
      : null;
    const prefs = await Prefs.findOne({});

    const {
      email,
      phone,
      firstName,
      lastName,
      position,
      role,
      isActive,
      isAdmin,
      isEndUser,
      isServiceAccount,
      isCloudTelephony,
      hideWorkStatus,
      categories,
      permissions,
      dashboard,
      finances,
      getScreen,
    } = req.body;

    if (prevSubdivision) {
      prevSubdivision.users = prevSubdivision.users.filter(
        (id) => id.toString() !== user._id.toString(),
      );
      await prevSubdivision.save();
    }

    if (newSubdivision) {
      user.subdivision = newSubdivision._id;
      newSubdivision.users.push(user._id);
      await newSubdivision.save();
    } else {
      user.subdivision = null;
    }

    let categoriesList = [];
    const categoriesArray = concatIdsArray(categories, user.categories);
    for (let categoryId of categoriesArray) {
      const updatedCategory = await TicketCategory.findById(categoryId);
      if (updatedCategory) {
        let filteredUsers = updatedCategory.users.filter(
          (categoryUser) => categoryUser._id.toString() !== user._id.toString(),
        );

        if (categories.includes(updatedCategory._id.toString())) {
          categoriesList.push(updatedCategory);
          filteredUsers.push(user);
        }
        updatedCategory.users = filteredUsers;
        await updatedCategory.save();
      }
    }

    user.email = email?.toLowerCase();
    user.phone = phone;
    user.firstName = firstName;
    user.lastName = lastName || "";
    user.position = position;
    user.categories = categoriesList.filter(Boolean);
    user.company = newCompany;
    user.role = role ?? role;
    user.isActive = isActive;
    user.isAdmin = isAdmin;
    user.isEndUser = isEndUser;
    user.isServiceAccount = isServiceAccount;
    user.isCloudTelephony = isCloudTelephony;
    user.hideWorkStatus = !!hideWorkStatus;
    user.permissions = permissions;
    user.dashboard = dashboard;

    // Финансовые поля меняют только админ или обладатель глобального фин.
    // права; без права или без поля в запросе — не трогаем, чтобы не затереть
    const caller = await getAuthData(req);
    if (finances !== undefined && canManageFinances(caller)) {
      user.finances = {
        salary: toNonNegativeOrNull(finances?.salary),
        overtimeHourlyRate: toNonNegativeOrNull(finances?.overtimeHourlyRate),
      };
    }

    if (prefs.getScreen.isActive) {
      user.getScreen.api = getScreen ? getScreen.api : user.getScreen.api;
    }

    await user.save();

    // Обновляем название рабочего места при изменении имени пользователя
    try {
      const workplace = await Location.findOne({
        type: "workplace",
        assignedUser: user._id,
        isActive: true,
      });

      if (workplace) {
        const newWorkplaceName =
          `Рабочее место - ${firstName} ${lastName || ""}`.trim();
        const newDescription = `Рабочее место сотрудника ${firstName} ${lastName || ""}`;

        workplace.name = newWorkplaceName;
        workplace.description = newDescription;
        workplace.subdivision = newSubdivision ? newSubdivision._id : null;
        await workplace.save();
      }
    } catch (workplaceError) {
      next(
        new AppError(
          `Failed to update user ${req.params.id} workplace `,
          500,
          true,
          error,
        ),
      );
    }

    if (newCompany._id.toString() !== prevCompany._id.toString()) {
      newCompany.employees.push(user);

      prevCompany.employees = prevCompany.employees.filter(
        (item) => item.toString() !== user._id.toString(),
      );

      await prevCompany.save();
      await newCompany.save();
    }

    res.status(201).json({
      message: "Данные пользователя обновлены",
      userId: user._id,
    });
  } catch (error) {
    next(
      new AppError(`Failed to update user ${req.params.id}`, 500, true, error),
    );
  }
};

exports.toggleActive = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return next(new AppError(`User ${req.params.id} not found`, 404));
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      message: "User active status toggled",
      isActive: user.isActive,
    });
  } catch (error) {
    next(new AppError(`Failed to toggle user active status`, 500, true, error));
  }
};

exports.delete = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (user) {
      const company = await Company.findById(user.company._id);

      if (company) {
        company.employees = company.employees.filter(
          (item) => item._id.toString() !== user._id.toString(),
        );
        await company.save();
      }

      if (user.subdivision) {
        const subdivision = await Subdivision.findById(user.subdivision);
        if (subdivision) {
          subdivision.users = subdivision.users.filter(
            (id) => id.toString() !== user._id.toString(),
          );
          await subdivision.save();
        }
      }

      for (let category of user.categories) {
        const updatedCategory = await TicketCategory.findById(category._id);
        if (updatedCategory) {
          const filteredUsers = updatedCategory.users.filter(
            (categoryUser) =>
              categoryUser._id.toString() !== user._id.toString(),
          );

          updatedCategory.users = filteredUsers;

          await updatedCategory.save();
        }
      }

      // Деактивируем рабочее место пользователя
      try {
        const workplace = await Location.findOne({
          type: "workplace",
          assignedUser: user._id,
          isActive: true,
        });

        if (workplace) {
          workplace.isActive = false;
          workplace.assignedUser = null;
          workplace.notes = `Деактивировано при удалении пользователя ${user.email} ${new Date().toISOString()}`;
          await workplace.save();

          console.log(
            `Рабочее место деактивировано для удаленного пользователя ${user.email}: ${workplace.name}`,
          );
        }
      } catch (workplaceError) {
        console.error(
          `Ошибка при деактивации рабочего места для пользователя ${user.email}:`,
          workplaceError,
        );
        // Не прерываем удаление пользователя, только логируем ошибку
      }

      await User.deleteOne({ _id: req.params.id });

      res.status(201).json({
        message: "Пользователь удалён",
      });
    }
  } catch (error) {
    next(
      new AppError(`Failed to delete user ${req.params.id}`, 500, true, error),
    );
  }
};

exports.createWorkplacesForExistingUsers = async (req, res, next) => {
  try {
    // Получаем всех активных пользователей
    const users = await User.find({ isActive: true });

    let created = 0;
    let skipped = 0;
    let errors = [];

    for (const user of users) {
      try {
        // Проверяем, есть ли уже рабочее место у пользователя
        const existingWorkplace = await Location.findOne({
          type: "workplace",
          assignedUser: user._id,
          isActive: true,
        });

        if (existingWorkplace) {
          skipped++;
          continue;
        }

        // Создаем рабочее место
        const workplaceName =
          `Рабочее место - ${user.firstName} ${user.lastName || ""}`.trim();

        const workplace = new Location({
          name: workplaceName,
          type: "workplace",
          description: `Рабочее место сотрудника ${user.firstName} ${user.lastName || ""}`,
          company: user.company._id,
          subdivision: user.subdivision || null,
          assignedUser: user._id,
          defaultResponsible: user._id,
          isActive: true,
          isAccessible: true,
          securityLevel: "internal",
          createdBy: req.userId || user._id,
        });

        await workplace.save();
        created++;

        console.log(
          `Рабочее место создано для ${user.email}: ${workplace.name}`,
        );
      } catch (userError) {
        errors.push({
          userId: user._id,
          email: user.email,
          error: userError.message,
        });
        console.error(
          `Ошибка создания рабочего места для ${user.email}:`,
          userError,
        );
      }
    }

    res.status(200).json({
      message: "Процесс создания рабочих мест завершен",
      statistics: {
        totalUsers: users.length,
        created,
        skipped,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    next(
      new AppError(
        "Failed to create workplaces for existing users",
        500,
        true,
        error,
      ),
    );
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { password, repeatedPassword, sendPassword } = req.body;

    const user = await User.findById(req.params.id);

    if (password !== repeatedPassword) {
      return next(new AppError(`Пароли не совпадают`, 401));
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    user.password = hashedPassword;
    user.notifications = {
      lastAction: "change password",
      password: jwt.sign(password, process.env.JWT_SECRET),
      pending: sendPassword,
    };

    await user.save();

    res.status(201).json({
      message: "Пароль успешно сброшен",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to change password for user ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.deleteBackgroundImage = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);

    const user = await User.findById(userId);

    if (!user) {
      return next(new AppError(`User not found`, 404));
    }

    await storage.deleteObject(user.backgroundImagePath);

    user.backgroundImagePath = "";

    await user.save();

    res.status(201).json({
      message: "Файл успешно удалён",
      backgroundImagePath: "",
    });
  } catch (error) {
    next(new AppError(`Failed to delete background image`, 500, true, error));
  }
};

exports.addBackgroundImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError(`File not uploaded`, 400));
    }

    const { userId } = await getAuthData(req);

    const user = await User.findById(userId);

    if (!user) {
      return next(new AppError(`User not found`, 404));
    }

    if (user.backgroundImagePath) {
      await storage.deleteObject(user.backgroundImagePath);
    }

    user.backgroundImagePath = req.file.key;

    await user.save();

    res.status(201).json({
      message: "Файл успешно загружен",
      backgroundImagePath: user.backgroundImagePath,
    });
  } catch (error) {
    next(new AppError(`Failed to add background image`, 500, true, error));
  }
};

exports.addProfileImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError(`File not uploaded`, 400));
    }

    const userId = req.params.id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(400).json({ error: "Пользователь не найден" });
    }

    if (user.profileImagePath) {
      await storage.deleteObject(user.profileImagePath);
    }

    user.profileImagePath = req.file.key;

    await user.save();

    res.status(201).json({
      message: "Файл успешно загружен",
      profileImagePath: user.profileImagePath,
    });
  } catch (error) {
    next(new AppError(`Failed to add profile image`, 500, true, error));
  }
};

exports.updateMyAccount = async (req, res, next) => {
  try {
    const {
      id,
      firstName,
      lastName,
      email,
      phone,
      position,
      categories,
      notify,
      telegramBot,
    } = req.body;

    const user = await User.findById(id);

    user.email = email ? email : user.email;
    user.phone = phone ? phone : user.phone;
    user.firstName = firstName ? firstName : user.firstName;
    user.lastName = lastName ? lastName : user.lastName;
    user.position = position ? position : user.position;
    user.categories = categories ? categories : user.categories;
    user.notify = notify ? notify : user.notify;
    user.telegramBot = telegramBot ? telegramBot : user.telegramBot;

    await user.save();

    res.status(201).json({
      message: "Данные пользователя успешно обновлены",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.lastName,
        phone: user.phone,
        position: user.position,
        categories: user.categories,
        notify: user.notify,
        telegramBot: user.telegramBot,
      },
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update user account with id ${req.body.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Смена собственного статуса присутствия (веб). Identity строго из токена.
exports.setWorkStatus = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError(`User ${userId} not found`, 404));
    }

    if (user.hideWorkStatus) {
      return next(
        new AppError(
          "Статусы присутствия отключены для вашей учётной записи",
          403,
          true,
        ),
      );
    }

    const { code } = req.body;
    if (!WORK_STATUS_CODES.includes(code)) {
      return next(new AppError(`Некорректный статус "${code}"`, 400, true));
    }

    const note = String(req.body.note ?? "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 100);

    user.workStatus = { code, note, updatedAt: new Date() };
    await user.save();

    res.status(200).json({
      message: "Статус обновлён",
      workStatus: user.workStatus,
    });
  } catch (error) {
    next(new AppError(`Failed to set work status`, 500, true, error));
  }
};

// Смена статуса тапом по инлайн-кнопке под Telegram-табло. Сотрудник
// определяется по личному chat id (равен telegram user id в приватном чате).
// Заметка при этом очищается — она описывала предыдущий статус.
exports.setWorkStatusFromTelegram = async (req, res, next) => {
  try {
    const { tgUserId, code } = req.query;

    const user = await User.findOne({
      "telegramBot.chatId": String(tgUserId || ""),
      "telegramBot.isActive": true,
    });
    if (!user) {
      return next(
        new AppError(
          "Telegram не привязан к учётной записи. Привяжите его в «Мой аккаунт»",
          404,
          true,
        ),
      );
    }
    if (user.isEndUser || user.isServiceAccount) {
      return next(
        new AppError("Статусы доступны только сотрудникам", 403, true),
      );
    }
    if (user.hideWorkStatus) {
      return next(
        new AppError(
          "Статусы присутствия отключены для вашей учётной записи",
          403,
          true,
        ),
      );
    }
    if (!WORK_STATUS_CODES.includes(code)) {
      return next(new AppError(`Некорректный статус "${code}"`, 400, true));
    }

    user.workStatus = { code, note: "", updatedAt: new Date() };
    await user.save();

    const meta = WORK_STATUS_BY_CODE[code];
    res.status(200).json({
      message: `Статус обновлён: ${meta.emoji} ${meta.label}`,
      workStatus: user.workStatus,
    });
  } catch (error) {
    next(
      new AppError(`Failed to set work status from telegram`, 500, true, error),
    );
  }
};

// Лёгкий список статусов сотрудников для бара (поллинг раз в 15 секунд)
exports.getWorkStatuses = async (req, res, next) => {
  try {
    const users = await User.find({
      isActive: true,
      isEndUser: false,
      isServiceAccount: false,
      isCloudTelephony: false,
      hideWorkStatus: { $ne: true },
    })
      .select("_id firstName lastName profileImagePath workStatus")
      .sort({ lastName: 1 })
      .lean();

    res.status(200).json({ message: "Work statuses fetched", users });
  } catch (error) {
    next(new AppError(`Failed to fetch work statuses`, 500, true, error));
  }
};

exports.disableChangelogNotification = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const user = await User.findById(userId);

    user.notifications.changelogUpdate = false;

    await user.save();

    res.status(201).json({
      message: "User notifications updated successfully!",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to disable changelog notification`,
        500,
        true,
        error,
      ),
    );
  }
};

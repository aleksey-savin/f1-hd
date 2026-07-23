const TicketTemplate = require("../models/ticketTemplate");
const RoutineTask = require("../models/routineTask");
const User = require("../models/user");
const Company = require("../models/company");

const getAuthData = require("../middleware/getAuthData");

const { AppError } = require("../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const { _id: userId, company, permissions } = await getAuthData(req);
    const authedUser = await User.findById(userId);

    let templates = [];

    if (permissions.canManageTicketTemplates) {
      templates = await TicketTemplate.find({})
        .populate("categoryId", "_id title")
        .sort({
          title: 1,
        });

      return res.status(200).json(templates);
    }

    templates = await TicketTemplate.find({
      $or: [
        { "createdBy._id": userId },
        { sharedCompanies: company },
        { sharedUsers: authedUser },
      ],
    })
      .populate("categoryId", "_id title")
      .sort({
        title: 1,
      });

    res.status(200).json(templates);
  } catch (error) {
    next(new AppError(`Failed to fetch ticket templates`, 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const template = await TicketTemplate.findById(req.params.id).populate(
      "categoryId",
      "_id title",
    );
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }
    res.status(200).json(template);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch ticket template ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

const actor = (user) => ({
  _id: user._id,
  firstName: user.firstName || "",
  lastName: user.lastName || "",
});

// Единообразно собираем данные шаблона из тела запроса (add и update): компания
// и категория — по id, шеринг — id → объекты, поля и чек-лист чистим от пустых.
// Клиент (isEndUser) не выбирает компанию — шарит только своей.
const buildTemplateData = async (body, isEndUser, authedUserCompany) => {
  const {
    title,
    description,
    categoryId,
    company: companyId,
    customFields,
    checklist,
    allowAllStaff,
    sharedCompanies: sharedCompaniesIds = [],
    sharedUsers: sharedUsersIds = [],
  } = body;

  let company = {};
  if (isEndUser) {
    company = authedUserCompany || {};
  } else if (companyId) {
    const found = await Company.findById(companyId);
    if (found) company = { _id: found._id, alias: found.alias };
  }

  let sharedCompanies = [];
  if (isEndUser) {
    if (authedUserCompany && authedUserCompany._id) {
      sharedCompanies = [
        { _id: authedUserCompany._id, alias: authedUserCompany.alias },
      ];
    }
  } else {
    for (const id of sharedCompaniesIds) {
      const found = await Company.findById(id);
      if (found) sharedCompanies.push({ _id: found._id, alias: found.alias });
    }
  }

  const sharedUsers = [];
  for (const id of sharedUsersIds) {
    const found = await User.findById(id);
    if (found) {
      sharedUsers.push({
        _id: found._id,
        firstName: found.firstName || "",
        lastName: found.lastName || "",
      });
    }
  }

  return {
    title,
    description,
    categoryId: categoryId || undefined,
    company,
    customFields: Array.isArray(customFields)
      ? customFields.filter((field) => field && field.name && field.name.trim())
      : [],
    checklist: Array.isArray(checklist)
      ? checklist
          .filter((item) => item && item.description && item.description.trim())
          .map((item) => ({
            description: item.description,
            mandatory: !!item.mandatory,
          }))
      : [],
    allowAllStaff: !!allowAllStaff,
    sharedCompanies,
    sharedUsers,
  };
};

exports.add = async (req, res, next) => {
  try {
    const {
      userId,
      isEndUser,
      company: authedUserCompany,
    } = await getAuthData(req);
    const authedUser = await User.findById(userId);

    const data = await buildTemplateData(
      req.body,
      isEndUser,
      authedUserCompany,
    );

    const template = new TicketTemplate({
      ...data,
      createdBy: actor(authedUser),
      updatedBy: actor(authedUser),
    });

    await template.save();
    res.status(201).json(template);
  } catch (error) {
    next(new AppError(`Failed to add ticket template`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const {
      userId,
      isEndUser,
      company: authedUserCompany,
    } = await getAuthData(req);
    const authedUser = await User.findById(userId);

    const template = await TicketTemplate.findById(req.params.id);
    if (!template) {
      return next(
        new AppError(`Ticket template ${req.params.id} not found`, 404),
      );
    }

    const data = await buildTemplateData(
      req.body,
      isEndUser,
      authedUserCompany,
    );
    Object.assign(template, data);
    template.updatedBy = actor(authedUser);

    await template.save();

    // Регламенты, созданные из этого шаблона — фронт предложит их синхронизировать.
    const childRoutines = await RoutineTask.find({
      "sourceTemplate._id": template._id,
    }).select("_id title cronSchedule company isActive");

    res.status(201).json({ template, childRoutines });
  } catch (error) {
    next(new AppError(`Failed to update ticket template`, 500, true, error));
  }
};

// Синхронизировать выбранные регламенты-потомки с шаблоном: обновляются только
// унаследованные поля (тема, описание, категория, чек-лист). Операционные поля
// регламента (расписание, инициатор, ответственные, компания) не трогаются.
// Расписание не меняется → планировщик не перерегистрируем (runRoutineTask
// читает свежие поля из БД сам).
exports.syncRoutines = async (req, res, next) => {
  try {
    const routineIds = Array.isArray(req.body.routineIds)
      ? req.body.routineIds
      : [];
    if (!routineIds.length) {
      return res.status(200).json({ updated: 0 });
    }

    const template = await TicketTemplate.findById(req.params.id).populate(
      "categoryId",
      "_id title",
    );
    if (!template) {
      return next(
        new AppError(`Ticket template ${req.params.id} not found`, 404),
      );
    }

    const patch = {
      title: template.title,
      description: template.description,
      checklist: (template.checklist || []).map((item) => ({
        description: item.description,
        mandatory: !!item.mandatory,
        checked: false,
      })),
    };
    if (template.categoryId?._id) {
      patch.category = {
        _id: template.categoryId._id,
        title: template.categoryId.title,
      };
    }

    const result = await RoutineTask.updateMany(
      { _id: { $in: routineIds }, "sourceTemplate._id": template._id },
      { $set: patch },
    );

    res.status(201).json({ updated: result.modifiedCount ?? 0 });
  } catch (error) {
    next(new AppError(`Failed to sync routines`, 500, true, error));
  }
};

// Правка только чек-листа шаблона (с карточки, отдельно от полной формы).
exports.updateChecklist = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const authedUser = await User.findById(userId);

    const template = await TicketTemplate.findById(req.params.id);
    if (!template) {
      return next(
        new AppError(`Ticket template ${req.params.id} not found`, 404),
      );
    }

    const checklist = Array.isArray(req.body.checklist)
      ? req.body.checklist
      : [];
    template.checklist = checklist
      .filter((item) => item && item.description && item.description.trim())
      .map((item) => ({
        description: item.description,
        mandatory: !!item.mandatory,
      }));
    template.updatedBy = actor(authedUser);

    await template.save();
    res.status(201).json(template);
  } catch (error) {
    next(
      new AppError(
        `Failed to update ticket template checklist`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    await TicketTemplate.deleteOne({ _id: req.params.id });

    res.status(201).json({
      message: "Ticket deleted successfully!",
    });
  } catch (error) {
    next(new AppError(`Failed to delete ticket template`, 500, true, error));
  }
};

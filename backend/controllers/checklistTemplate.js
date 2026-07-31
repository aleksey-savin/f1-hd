const ChecklistTemplate = require("@/models/checklistTemplate");
const { Ticket } = require("@/models/ticket");
const TicketCategory = require("@/models/ticketCategory");
const Company = require("@/models/company");
const getAuthData = require("@/middleware/getAuthData");
const { AppError } = require("@/middleware/errorHandling");
const {
  templatesForTicket,
  autoApplyEnabled,
} = require("@/services/checklistTemplates");

/** Справочник шаблонов чек-листов: список, создание, правка, удаление. */

const actor = ({ userId, firstName, lastName }) => ({
  _id: userId,
  firstName,
  lastName,
});

const cleanItems = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      description: String(item?.description ?? "").trim(),
      mandatory: !!item?.mandatory,
    }))
    .filter((item) => item.description.length > 0);

/**
 * Справочники для формы шаблона. Своя ручка, а не чужие списки категорий и
 * компаний: те закрыты правами на управление категориями и на клиентов, а
 * шаблоны чек-листов правит администратор заявок — он бы просто не получил
 * список привязок.
 */
exports.getFormData = async (req, res, next) => {
  try {
    const [categories, companies] = await Promise.all([
      TicketCategory.find({}).select("title").sort({ title: 1 }).lean(),
      Company.find({}).select("alias").sort({ alias: 1 }).lean(),
    ]);

    res.status(200).json({ categories, companies });
  } catch (error) {
    next(new AppError("Failed to fetch checklist form data", 500, true, error));
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const templates = await ChecklistTemplate.find({})
      .populate({ path: "categories", select: "title" })
      .populate({ path: "companies", select: "alias" })
      .sort({ title: 1 })
      .lean();

    res.status(200).json(templates);
  } catch (error) {
    next(new AppError("Failed to fetch checklist templates", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const template = await ChecklistTemplate.findById(req.params.id)
      .populate({ path: "categories", select: "title" })
      .populate({ path: "companies", select: "alias" })
      .lean();

    if (!template) {
      return next(new AppError("Шаблон чек-листа не найден", 404));
    }

    res.status(200).json(template);
  } catch (error) {
    next(new AppError("Failed to fetch checklist template", 500, true, error));
  }
};

exports.add = async (req, res, next) => {
  try {
    const authData = await getAuthData(req);
    const { title, items, categories, companies, isActive } = req.body;

    if (!String(title ?? "").trim()) {
      return next(new AppError("Укажите название шаблона", 422));
    }

    const template = new ChecklistTemplate({
      title: String(title).trim(),
      items: cleanItems(items),
      categories: categories || [],
      companies: companies || [],
      isActive: isActive !== false,
      createdBy: actor(authData),
      updatedBy: actor(authData),
    });

    await template.save();

    res.status(201).json({ message: "Шаблон создан", template });
  } catch (error) {
    next(new AppError("Failed to add checklist template", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const authData = await getAuthData(req);
    const template = await ChecklistTemplate.findById(req.params.id);

    if (!template) {
      return next(new AppError("Шаблон чек-листа не найден", 404));
    }

    const { title, items, categories, companies, isActive } = req.body;

    if (title !== undefined) {
      if (!String(title).trim()) {
        return next(new AppError("Укажите название шаблона", 422));
      }
      template.title = String(title).trim();
    }
    if (items !== undefined) template.items = cleanItems(items);
    if (categories !== undefined) template.categories = categories;
    if (companies !== undefined) template.companies = companies;
    if (isActive !== undefined) template.isActive = !!isActive;
    template.updatedBy = actor(authData);

    await template.save();

    res.status(200).json({ message: "Шаблон изменён", template });
  } catch (error) {
    next(new AppError("Failed to update checklist template", 500, true, error));
  }
};

exports.delete = async (req, res, next) => {
  try {
    const removed = await ChecklistTemplate.findByIdAndDelete(req.params.id);

    if (!removed) {
      return next(new AppError("Шаблон чек-листа не найден", 404));
    }

    res.status(200).json({ message: "Шаблон удалён" });
  } catch (error) {
    next(new AppError("Failed to delete checklist template", 500, true, error));
  }
};

/**
 * Шаблоны, подходящие конкретной заявке: для поповера «Ещё чек-листы» и
 * счётчика «Взять шаблон · N». Ранжирование делает сервис — второй копии
 * правила «побеждает узкий» на клиенте не заводим.
 */
exports.forTicket = async (req, res, next) => {
  try {
    const ticket = await Ticket.findOne({ num: +req.params.ticketNum })
      .select("categoryId company routineTask")
      .lean();

    if (!ticket) {
      return next(new AppError("Ticket not found", 404));
    }

    const { matched, others } = await templatesForTicket(ticket);

    res.status(200).json({
      // У регламентной заявки чек-лист — часть определения задания, шаблоны его
      // не подменяют: подбор для неё пуст
      matched: ticket.routineTask ? [] : matched,
      others,
      autoApply: await autoApplyEnabled(),
    });
  } catch (error) {
    next(
      new AppError("Failed to match checklist templates", 500, true, error),
    );
  }
};

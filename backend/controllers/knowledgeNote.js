const KnowledgeNote = require("../models/knowledgeNote");
const Company = require("../models/company");
const User = require("../models/user");
const TicketCategory = require("../models/ticketCategory");

const { AppError } = require("../middleware/errorHandling");
const getAuthData = require("../middleware/getAuthData");
const { markdownToPlainText } = require("../helpers/markdownToPlainText");
const { canViewNote } = require("../helpers/knowledgeNoteVisibility");

const NOTE_TYPES = ["info", "backlog", "instructions"];

// Приводит тип заметки к допустимому значению (некорректное/пустое → "info")
const normalizeType = (type) => (NOTE_TYPES.includes(type) ? type : "info");

// Превращает массив id компаний в denormalized-массив для заметки
const buildCompanies = async (ids = []) => {
  const list = [];
  for (const id of ids) {
    if (!id) continue;
    const company = await Company.findById(id);
    if (company) {
      list.push({ _id: company._id, alias: company.alias });
    }
  }
  return list;
};

// Превращает массив id пользователей в denormalized-массив (с компанией пользователя)
const buildUsers = async (ids = []) => {
  const list = [];
  for (const id of ids) {
    if (!id) continue;
    const user = await User.findById(id);
    if (user) {
      list.push({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company
          ? { _id: user.company._id, alias: user.company.alias }
          : undefined,
      });
    }
  }
  return list;
};

// Превращает массив id категорий заявок в denormalized-массив
const buildCategories = async (ids = []) => {
  const list = [];
  for (const id of ids) {
    if (!id) continue;
    const category = await TicketCategory.findById(id);
    if (category) {
      list.push({ _id: category._id, title: category.title });
    }
  }
  return list;
};

// Список заметок, доступных пользователю (без тяжёлого content; plainText — для поиска на клиенте)
exports.getAll = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    const notes = await KnowledgeNote.find({}, { content: 0 })
      .sort({ updatedAt: -1 })
      .lean();

    const visibleNotes = notes.filter((note) => canViewNote(note, authedUser));

    res.status(200).json(visibleNotes);
  } catch (error) {
    next(new AppError(`Failed to fetch knowledge notes`, 500, true, error));
  }
};

// Заметки, связанные с контекстом заявки (компания / категория / инициатор).
// Совпадение хотя бы по одному из переданных id; контент не отдаём (для списка),
// ранжирование по релевантности — на клиенте.
exports.getRelated = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);
    const { company, category, user } = req.query;

    const or = [];
    if (company) or.push({ "companies._id": company });
    if (category) or.push({ "categories._id": category });
    if (user) or.push({ "users._id": user });

    if (!or.length) {
      return res.status(200).json([]);
    }

    const notes = await KnowledgeNote.find({ $or: or }, { content: 0 })
      .sort({ updatedAt: -1 })
      .lean();

    const visibleNotes = notes.filter((note) => canViewNote(note, authedUser));

    res.status(200).json(visibleNotes);
  } catch (error) {
    next(
      new AppError(`Failed to fetch related knowledge notes`, 500, true, error),
    );
  }
};

// Полная заметка (с content) — с проверкой видимости
exports.getOne = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);
    const note = await KnowledgeNote.findById(req.params.id).lean();

    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    if (!canViewNote(note, authedUser)) {
      return next(new AppError(`Недостаточно прав для просмотра заметки`, 403));
    }

    res.status(200).json(note);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const {
      title = "",
      content = "",
      companies = [],
      users = [],
      categories = [],
      type,
    } = req.body;

    if (!title.trim()) {
      return next(new AppError(`Заголовок заметки обязателен`, 422));
    }

    const note = new KnowledgeNote({
      title,
      content,
      plainText: markdownToPlainText(content),
      companies: await buildCompanies(companies),
      users: await buildUsers(users),
      categories: await buildCategories(categories),
      type: normalizeType(type),
      createdBy: userId,
      updatedBy: userId,
    });

    await note.save();

    res.status(201).json({
      message: "Заметка успешно создана",
      note,
    });
  } catch (error) {
    next(new AppError(`Failed to create knowledge note`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const note = await KnowledgeNote.findById(req.params.id);

    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    const {
      title = "",
      content = "",
      companies = [],
      users = [],
      categories = [],
      type,
    } = req.body;

    if (!title.trim()) {
      return next(new AppError(`Заголовок заметки обязателен`, 422));
    }

    note.title = title;
    note.content = content;
    note.plainText = markdownToPlainText(content);
    note.companies = await buildCompanies(companies);
    note.users = await buildUsers(users);
    note.categories = await buildCategories(categories);
    note.type = normalizeType(type);
    note.updatedBy = userId;

    await note.save();

    res.status(200).json({
      message: "Заметка успешно изменена",
      note,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const note = await KnowledgeNote.findById(req.params.id);

    if (!note) {
      return next(new AppError(`Заметка не найдена`, 404));
    }

    await KnowledgeNote.deleteOne({ _id: req.params.id });

    res.status(200).json({ message: "Заметка удалена" });
  } catch (error) {
    next(
      new AppError(
        `Failed to delete knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Данные для селектов формы заметки. Эндпоинт доступен только носителям
// canManageKnowledgeBase / админам, которые видят все сущности.
exports.getFormData = async (req, res, next) => {
  try {
    const [companies, users, categories] = await Promise.all([
      Company.find({}).sort({ alias: 1 }),
      User.find({ isActive: true, isServiceAccount: false }).sort({
        lastName: 1,
      }),
      TicketCategory.find({ isActive: true }).sort({ title: 1 }),
    ]);

    res.status(200).json({
      companies: companies.map((company) => ({
        _id: company._id,
        alias: company.alias,
        fullTitle: company.fullTitle,
      })),
      users: users.map((user) => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company
          ? { _id: user.company._id, alias: user.company.alias }
          : undefined,
      })),
      categories: categories.map((category) => ({
        _id: category._id,
        title: category.title,
      })),
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch knowledge note form data`,
        500,
        true,
        error,
      ),
    );
  }
};

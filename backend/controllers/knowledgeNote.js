const KnowledgeNote = require("../models/knowledgeNote");
const Company = require("../models/company");
const User = require("../models/user");
const TicketCategory = require("../models/ticketCategory");
const Preferences = require("../models/preferences");

const { AppError } = require("../middleware/errorHandling");
const { markdownToPlainText } = require("../helpers/markdownToPlainText");
const { rescanNoteDerived } = require("../helpers/knowledgeNoteDerived");
const {
  getModerationCounts,
  ZERO_COUNTS,
} = require("../services/knowledgeModerationCounts");
const {
  canViewNote,
  isModerator,
} = require("../helpers/knowledgeNoteVisibility");

// Конфиг модерации для проверки видимости: флаг скрытия и id модераторов.
const getKbConfig = async () => {
  const prefs = await Preferences.findOne({}).lean();
  const kb = prefs?.knowledgeBase || {};
  return {
    hideNotApproved: !!kb.hideNotApproved,
    scanForSecrets: !!kb.scanForSecrets,
    moderatorIds: (kb.moderators || [])
      .map((moderator) => moderator?._id?.toString())
      .filter(Boolean),
  };
};

// Ссылки на людей, совершивших действие над заметкой. Клиент показывает их
// имена («Проверено · Иванов И. · 12 июня», «Пётр Петров запросил удаление»),
// поэтому подтягиваем их и в getOne, и в ответы мутаций — иначе после действия
// в интерфейсе висел бы голый id до перезагрузки страницы.
// В getAll не подтягиваем: список показывает только иконку проверки, не имена.
const ACTOR_PATHS = [
  "approvedBy",
  "updatedBy",
  "pendingDeletionBy",
  "pendingArchiveBy",
  "archivedBy",
].map((path) => ({ path, select: "firstName lastName" }));

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

// Что список НЕ получает. Раньше отдавали plainText, потому что поиск жил на
// клиенте: на двух сотнях статей это мегабайты при каждом заходе в раздел.
// Теперь ищет сервер, а списку хватает заголовка, привязок и флагов.
// secretsScan.flagged остаётся (иконка в строке), findings — нет.
const LIST_PROJECTION = {
  content: 0,
  plainText: 0,
  "secretsScan.findings": 0,
  "secretsScan.ignoredHashes": 0,
  serviceExpiry: 0,
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Каждое слово запроса должно встретиться где-то в заметке (AND по словам,
// OR по полям) — та же семантика, что была на клиенте. Число слов ограничиваем:
// запрос из сотни слов превратился бы в сотню регулярок по коллекции.
const MAX_SEARCH_TERMS = 8;

const buildSearchConditions = (raw) => {
  const terms = String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS);

  if (terms.length === 0) {
    return null;
  }

  return terms.map((term) => {
    const pattern = new RegExp(escapeRegex(term), "i");
    return {
      $or: [
        { title: pattern },
        { plainText: pattern },
        { "companies.alias": pattern },
        { "categories.title": pattern },
        { "users.firstName": pattern },
        { "users.lastName": pattern },
      ],
    };
  });
};

// Список заметок, доступных пользователю. Поиск (?search=) — на сервере.
exports.getAll = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const kbConfig = await getKbConfig();

    // По умолчанию — активные заметки (не в архиве). archived=true → архивные;
    // flaggedSecrets=true → все с найденными секретами (активные + архивные),
    // чтобы модератор мог добраться до утечек даже в архиве.
    let filter = { archivedAt: null };
    if (req.query.archived === "true") {
      filter = { archivedAt: { $ne: null } };
    } else if (req.query.flaggedSecrets === "true") {
      filter = { "secretsScan.flagged": true };
    }

    const searchConditions = buildSearchConditions(req.query.search);
    if (searchConditions) {
      filter.$and = searchConditions;
    }

    const notes = await KnowledgeNote.find(filter, LIST_PROJECTION)
      .sort({ updatedAt: -1 })
      .lean();

    const visibleNotes = notes.filter((note) =>
      canViewNote(note, req.auth, kbConfig),
    );

    res.status(200).json(visibleNotes);
  } catch (error) {
    next(new AppError(`Failed to fetch knowledge notes`, 500, true, error));
  }
};

// Список id из denormalized-массива привязок заметки (компании/категории/пользователи)
const idList = (items = []) =>
  items.map((item) => item?._id?.toString()).filter(Boolean);

// Подходит ли заметка контексту заявки с учётом ограничительных привязок.
// Компания и инициатор работают как ограничения: заметка, привязанная к
// компаниям (пользователям), показывается только в заявках этих компаний (этих
// инициаторов) и не «протекает» в чужие. Категория ограничением не является —
// заметка с категорией без компании видна в заявке любой компании по совпадению
// категории. Чтобы попасть в список, заметка должна совпасть хотя бы по одному
// измерению заявки.
const matchesTicketContext = (note, { company, category, user }) => {
  const noteCompanyIds = idList(note.companies);
  const noteUserIds = idList(note.users);
  const noteCategoryIds = idList(note.categories);

  // Ограничение по компании: за пределы привязанных компаний заметка не выходит
  if (noteCompanyIds.length && !(company && noteCompanyIds.includes(company))) {
    return false;
  }

  // Ограничение по инициатору: привязанная к пользователям заметка видна только им
  if (noteUserIds.length && !(user && noteUserIds.includes(user))) {
    return false;
  }

  const matchCompany = !!company && noteCompanyIds.includes(company);
  const matchCategory = !!category && noteCategoryIds.includes(category);
  const matchUser = !!user && noteUserIds.includes(user);

  return matchCompany || matchCategory || matchUser;
};

// Заметки, связанные с контекстом заявки (компания / категория / инициатор).
// Кандидаты — совпавшие хотя бы по одному id; затем отсекаем заметки, выходящие
// за свои ограничительные привязки (компания/инициатор). Контент не отдаём (для
// списка), ранжирование по релевантности — на клиенте.
exports.getRelated = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const kbConfig = await getKbConfig();
    const { company, category, user } = req.query;

    const or = [];
    if (company) or.push({ "companies._id": company });
    if (category) or.push({ "categories._id": category });
    if (user) or.push({ "users._id": user });

    if (!or.length) {
      return res.status(200).json([]);
    }

    // Заметки на удалении и в архиве в заявках не показываем
    const notes = await KnowledgeNote.find(
      { $or: or, pendingDeletion: { $ne: true }, archivedAt: null },
      { content: 0 },
    )
      .sort({ updatedAt: -1 })
      .lean();

    const visibleNotes = notes.filter(
      (note) =>
        canViewNote(note, req.auth, kbConfig) &&
        matchesTicketContext(note, { company, category, user }),
    );

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
    const authedUser = req.auth?.legacy ?? null;
    const kbConfig = await getKbConfig();
    const note = await KnowledgeNote.findById(req.params.id)
      .populate(ACTOR_PATHS)
      .lean();

    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    if (!canViewNote(note, req.auth, kbConfig)) {
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
    const { userId } = req.auth;
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

    await rescanNoteDerived(note);
    await note.save();
    await note.populate(ACTOR_PATHS);

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
    const { userId } = req.auth;
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
    // Любое изменение снимает отметку «Проверено» — заметку нужно проверить заново
    note.approved = false;
    note.approvedBy = undefined;
    note.approvedAt = undefined;
    // Заново пересчитываем секреты и услуги на свежем тексте, чтобы статусы
    // не висели устаревшими до кронов после правки содержимого заметки
    await rescanNoteDerived(note);

    await note.save();
    await note.populate(ACTOR_PATHS);

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

// Отправить заметку на удаление (мягко): ждёт подтверждения модератора.
// Доступно носителям canManageKnowledge.
exports.sendToDeletion = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const note = await KnowledgeNote.findById(req.params.id);

    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    note.pendingDeletion = true;
    note.pendingDeletionBy = userId;
    note.pendingDeletionAt = new Date();
    await note.save();
    await note.populate(ACTOR_PATHS);

    res.status(200).json({ message: "Заметка отправлена на удаление", note });
  } catch (error) {
    next(
      new AppError(
        `Failed to send knowledge note ${req.params.id} to deletion`,
        500,
        true,
        error,
      ),
    );
  }
};

// Подтвердить удаление заметки (жёсткое удаление из БД). Только модераторы.
exports.confirmDeletion = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { moderatorIds } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return next(
        new AppError(
          `Недостаточно прав: подтверждать удаление могут только модераторы`,
          403,
        ),
      );
    }

    const note = await KnowledgeNote.findById(req.params.id);

    if (!note) {
      return next(new AppError(`Заметка не найдена`, 404));
    }

    await KnowledgeNote.deleteOne({ _id: req.params.id });

    res.status(200).json({ message: "Заметка удалена" });
  } catch (error) {
    next(
      new AppError(
        `Failed to confirm deletion of knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Отклонить запрос на удаление (модератор) — снимает pendingDeletion
exports.declineDeletion = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { moderatorIds } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return next(
        new AppError(
          `Недостаточно прав: отклонять запросы могут только модераторы`,
          403,
        ),
      );
    }

    const note = await KnowledgeNote.findById(req.params.id);
    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    note.pendingDeletion = false;
    note.pendingDeletionBy = undefined;
    note.pendingDeletionAt = undefined;
    await note.save();
    await note.populate(ACTOR_PATHS);

    res.status(200).json({ message: "Запрос на удаление отклонён", note });
  } catch (error) {
    next(
      new AppError(
        `Failed to decline deletion of knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Отметить заметку проверенной. Только модераторы. Требуются оба подтверждения
// из диалога. В БД состояние хранится в полях approved/approvedBy/approvedAt.
exports.approve = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { moderatorIds } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return next(
        new AppError(
          `Недостаточно прав: отмечать заметки проверенными могут только модераторы`,
          403,
        ),
      );
    }

    const { confirmCurrent, confirmNoSecrets } = req.body;
    if (confirmCurrent !== true || confirmNoSecrets !== true) {
      return next(
        new AppError(`Необходимо подтвердить оба условия проверки`, 422),
      );
    }

    const note = await KnowledgeNote.findById(req.params.id);

    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    note.approved = true;
    note.approvedBy = authedUser.userId;
    note.approvedAt = new Date();
    await note.save();
    await note.populate(ACTOR_PATHS);

    res.status(200).json({ message: "Заметка отмечена как проверенная", note });
  } catch (error) {
    next(
      new AppError(
        `Failed to approve knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Запросить архивацию (мягко): ждёт подтверждения модератора.
// Доступно носителям canManageKnowledge.
exports.requestArchive = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const note = await KnowledgeNote.findById(req.params.id);

    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    note.pendingArchive = true;
    note.pendingArchiveBy = userId;
    note.pendingArchiveAt = new Date();
    await note.save();
    await note.populate(ACTOR_PATHS);

    res.status(200).json({ message: "Запрошена архивация заметки", note });
  } catch (error) {
    next(
      new AppError(
        `Failed to request archive for knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Подтвердить архивацию. Только модераторы. Заметка исчезает отовсюду.
exports.confirmArchive = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { moderatorIds } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return next(
        new AppError(
          `Недостаточно прав: подтверждать архивацию могут только модераторы`,
          403,
        ),
      );
    }

    const note = await KnowledgeNote.findById(req.params.id);
    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    note.archivedAt = new Date();
    note.archivedBy = authedUser.userId;
    note.pendingArchive = false;
    note.pendingArchiveBy = undefined;
    note.pendingArchiveAt = undefined;
    await note.save();
    await note.populate(ACTOR_PATHS);

    res.status(200).json({ message: "Заметка перемещена в архив", note });
  } catch (error) {
    next(
      new AppError(
        `Failed to confirm archive for knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Отклонить запрос на архивацию (модератор) — снимает pendingArchive
exports.declineArchive = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { moderatorIds } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return next(
        new AppError(
          `Недостаточно прав: отклонять запросы могут только модераторы`,
          403,
        ),
      );
    }

    const note = await KnowledgeNote.findById(req.params.id);
    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    note.pendingArchive = false;
    note.pendingArchiveBy = undefined;
    note.pendingArchiveAt = undefined;
    await note.save();
    await note.populate(ACTOR_PATHS);

    res.status(200).json({ message: "Запрос на архивацию отклонён", note });
  } catch (error) {
    next(
      new AppError(
        `Failed to decline archive for knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Восстановить заметку из архива. Доступно носителям canManageKnowledge.
exports.unarchive = async (req, res, next) => {
  try {
    const note = await KnowledgeNote.findById(req.params.id);

    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    note.archivedAt = undefined;
    note.archivedBy = undefined;
    await note.save();
    await note.populate(ACTOR_PATHS);

    res.status(200).json({ message: "Заметка восстановлена из архива", note });
  } catch (error) {
    next(
      new AppError(
        `Failed to unarchive knowledge note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// ── Массовые действия модерации ────────────────────────────────────────
// Очереди модерации разбирают пачками: 14 заметок на проверку — это 14 кликов
// по одиночному маршруту. Обходим выделение по одной заметке, а не updateMany:
// нужна человекочитаемая причина для тех, кого пропустили (статус успел
// измениться, пока модератор смотрел список).
const runBulkModeration = async (req, { precondition, skipReason, apply }) => {
  const authedUser = req.auth?.legacy ?? null;
  const kbConfig = await getKbConfig();

  if (!isModerator(authedUser, kbConfig.moderatorIds)) {
    return { forbidden: true };
  }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (ids.length === 0) {
    return { invalid: true };
  }

  const notes = await KnowledgeNote.find({ _id: { $in: ids } });
  const processed = [];
  const skipped = [];

  for (const note of notes) {
    // Модератор видит всё, но предикат видимости — единственная граница
    // доступа в этом модуле, поэтому проверяем и здесь (защита в глубину).
    if (!canViewNote(note, req.auth, kbConfig)) {
      skipped.push({ title: note.title, reason: "нет доступа" });
      continue;
    }
    if (!precondition(note)) {
      skipped.push({ title: note.title, reason: skipReason });
      continue;
    }
    await apply(note, authedUser);
    processed.push(note.title);
  }

  return { processed, skipped };
};

const bulkModerationHandler = ({
  precondition,
  skipReason,
  apply,
  success,
  failure,
}) => async (req, res, next) => {
  try {
    const result = await runBulkModeration(req, {
      precondition,
      skipReason,
      apply,
    });

    if (result.forbidden) {
      return next(
        new AppError(
          `Недостаточно прав: массовые действия модерации доступны только модераторам`,
          403,
        ),
      );
    }
    if (result.invalid) {
      return next(new AppError(`Не выбрано ни одной заметки`, 422));
    }

    res.status(200).json({
      message: success(result.processed.length),
      processed: result.processed.length,
      skipped: result.skipped,
    });
  } catch (error) {
    next(new AppError(failure, 500, true, error));
  }
};

// Отметить проверенными. Требует обоих подтверждений, как и одиночный маршрут:
// массовость не отменяет аттестацию модератора.
exports.approveMultiple = async (req, res, next) => {
  const { confirmCurrent, confirmNoSecrets } = req.body || {};
  if (confirmCurrent !== true || confirmNoSecrets !== true) {
    return next(new AppError(`Необходимо подтвердить оба условия проверки`, 422));
  }

  return bulkModerationHandler({
    precondition: (note) => !note.archivedAt,
    skipReason: "в архиве",
    apply: async (note, authedUser) => {
      note.approved = true;
      note.approvedBy = authedUser.userId;
      note.approvedAt = new Date();
      await note.save();
    },
    success: (count) => `Проверено: ${count}`,
    failure: "Failed to approve knowledge notes",
  })(req, res, next);
};

exports.confirmDeletionMultiple = bulkModerationHandler({
  precondition: (note) => note.pendingDeletion,
  skipReason: "нет запроса на удаление",
  apply: (note) => note.deleteOne(),
  success: (count) => `Удалено: ${count}`,
  failure: "Failed to confirm deletion of knowledge notes",
});

exports.declineDeletionMultiple = bulkModerationHandler({
  precondition: (note) => note.pendingDeletion,
  skipReason: "нет запроса на удаление",
  apply: async (note) => {
    note.pendingDeletion = false;
    note.pendingDeletionBy = undefined;
    note.pendingDeletionAt = undefined;
    await note.save();
  },
  success: (count) => `Запросов на удаление отклонено: ${count}`,
  failure: "Failed to decline deletion of knowledge notes",
});

exports.confirmArchiveMultiple = bulkModerationHandler({
  precondition: (note) => note.pendingArchive,
  skipReason: "нет запроса на архивацию",
  apply: async (note, authedUser) => {
    note.archivedAt = new Date();
    note.archivedBy = authedUser.userId;
    note.pendingArchive = false;
    note.pendingArchiveBy = undefined;
    note.pendingArchiveAt = undefined;
    await note.save();
  },
  success: (count) => `Перемещено в архив: ${count}`,
  failure: "Failed to confirm archive of knowledge notes",
});

exports.declineArchiveMultiple = bulkModerationHandler({
  precondition: (note) => note.pendingArchive,
  skipReason: "нет запроса на архивацию",
  apply: async (note) => {
    note.pendingArchive = false;
    note.pendingArchiveBy = undefined;
    note.pendingArchiveAt = undefined;
    await note.save();
  },
  success: (count) => `Запросов на архивацию отклонено: ${count}`,
  failure: "Failed to decline archive of knowledge notes",
});

// Сводка для модератора: счётчики для карточки на странице заявок и алерта.
// Немодераторам возвращаем нули.
exports.getModerationSummary = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { moderatorIds, scanForSecrets } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return res.status(200).json({ isModerator: false, ...ZERO_COUNTS });
    }

    const counts = await getModerationCounts({ scanForSecrets });

    res.status(200).json({ isModerator: true, ...counts });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch knowledge base moderation summary`,
        500,
        true,
        error,
      ),
    );
  }
};

// Услуги, у которых до продления остался месяц или меньше (включая просроченные).
// Блок «Сроки на исходе» на главной.
//
// Кто что видит. Сотрудники — всё, что им и так доступно по правилам базы
// знаний. Клиент — только услуги СВОЕЙ компании и только если он ответственный
// с её стороны (Company.clientsSideResponsibles): рядовому сотруднику клиента
// срок продления домена не адресован, а ответственному — адресован напрямую,
// потому что продлевать его ему.
//
// Само правило видимости заметки не дублируем: фильтруем готовым canViewNote —
// он уже знает и про скрытие неодобренных, и про «клиент видит только свою
// компанию». Поэтому в проекции обязаны быть все поля, которые он читает
// (companies/users/approved), иначе он молча решит, что связей нет.
exports.getServiceExpiry = async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({}).lean();
    const kb = prefs?.knowledgeBase || {};

    if (!kb.trackServiceExpiry) {
      return res.status(200).json({ services: [], count: 0 });
    }

    const authedUser = req.auth?.legacy ?? null;
    const { hideNotApproved, moderatorIds } = await getKbConfig();
    const empty = { services: [], count: 0 };

    // Кому вообще отвечаем, и по какому правилу потом фильтруем заметки.
    let ownCompanyId = null;
    if (authedUser.isEndUser) {
      ownCompanyId = authedUser.company?._id;
      if (!ownCompanyId) {
        return res.status(200).json(empty);
      }
      // Схема объявляет ссылку как `id`, но в базе она лежит в `_id` — матчим оба
      // (тот же разнобой, что у responsibleForCompanies, см. services/reportScope.js)
      const isClientSideResponsible = await Company.exists({
        _id: ownCompanyId,
        $or: [
          { "clientsSideResponsibles._id": authedUser._id },
          { "clientsSideResponsibles.id": authedUser._id },
        ],
      });
      if (!isClientSideResponsible) {
        return res.status(200).json(empty);
      }
    } else if (!req.auth.can({ knowledge: ["read"] })) {
      // Сотрудник без права «видеть базу знаний» не видел этого и раньше —
      // маршрут был закрыт middleware; гейт просто переехал сюда.
      return res.status(200).json(empty);
    }

    const days = kb.serviceExpiryDays > 0 ? kb.serviceExpiryDays : 30;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const allNotes = await KnowledgeNote.find(
      { archivedAt: null, "serviceExpiry.entries.expiresAt": { $lte: cutoff } },
      {
        title: 1,
        serviceExpiry: 1,
        categories: 1,
        companies: 1,
        users: 1,
        approved: 1,
      },
    ).lean();

    // Клиента через canViewNote не пропустить — он первым делом требует
    // canReadKnowledge, которого у клиента нет. Для него правило своё и
    // узкое: только своя компания, и неодобренное скрывается, если так
    // настроено. Для сотрудника правило не дублируем — оно уже написано.
    const notes = ownCompanyId
      ? allNotes.filter(
          (note) =>
            (!hideNotApproved || note.approved === true) &&
            (note.companies || []).some(
              (company) =>
                company._id?.toString() === ownCompanyId.toString(),
            ),
        )
      : allNotes.filter((note) =>
          canViewNote(note, req.auth, { hideNotApproved, moderatorIds }),
        );

    // Все записи в окне, дедуп по услуге (оставляем ближайшую дату)
    const byService = new Map();
    for (const note of notes) {
      for (const entry of note.serviceExpiry?.entries || []) {
        const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : null;
        if (!expiresAt || expiresAt > cutoff) {
          continue;
        }
        const key = entry.service.toLowerCase();
        const existing = byService.get(key);
        if (existing && new Date(existing.expiresAt) <= expiresAt) {
          continue;
        }
        byService.set(key, {
          service: entry.service,
          registrar: entry.registrar || "",
          expiresAt: entry.expiresAt,
          overdue: expiresAt < now,
          noteId: note._id,
          noteTitle: note.title,
          categories: (note.categories || []).map((category) => ({
            _id: category._id,
            title: category.title,
          })),
          // Чьё это — строка блока на главной сотрудника («Домен · БОЛТ»)
          companies: (note.companies || []).map((company) => ({
            _id: company._id,
            alias: company.alias,
          })),
        });
      }
    }

    const services = [...byService.values()].sort(
      (a, b) => new Date(a.expiresAt) - new Date(b.expiresAt),
    );

    res.status(200).json({ services, count: services.length });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch knowledge base service expiry`,
        500,
        true,
        error,
      ),
    );
  }
};

// Пометить находку секрета как «не секрет» (ложное срабатывание). Только модераторы.
// Сохраняем хэш значения в ignoredHashes — будущие сканы его пропустят. Реальный
// секрет (другое значение) в той же заметке по-прежнему сработает.
exports.ignoreSecretFinding = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { moderatorIds } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return next(
        new AppError(
          `Недостаточно прав: помечать находки может только модератор`,
          403,
        ),
      );
    }

    const { hash } = req.body;
    if (!hash) {
      return next(new AppError(`Не указан идентификатор находки`, 422));
    }

    const note = await KnowledgeNote.findById(req.params.id);
    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    if (!note.secretsScan) {
      note.secretsScan = { flagged: false, findings: [], ignoredHashes: [] };
    }

    const ignored = new Set(
      (note.secretsScan.ignoredHashes || []).map(String),
    );
    ignored.add(String(hash));
    note.secretsScan.ignoredHashes = [...ignored];

    // Убираем помеченную находку (во всех местах) и пересчитываем флаг
    note.secretsScan.findings = (note.secretsScan.findings || []).filter(
      (finding) => finding.hash !== hash,
    );
    note.secretsScan.flagged = note.secretsScan.findings.length > 0;

    await note.save();
    await note.populate(ACTOR_PATHS);

    res.status(200).json({ message: "Находка помечена как не секрет", note });
  } catch (error) {
    next(
      new AppError(
        `Failed to ignore secret finding for note ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Данные для селектов формы заметки. Эндпоинт доступен только носителям
// canManageKnowledge / админам, которые видят все сущности.
exports.getFormData = async (req, res, next) => {
  try {
    // Отключённые компании (и их люди) в форме привязки не предлагаются;
    // существующие привязки заметок остаются в документах как есть.
    const [companies, users, categories] = await Promise.all([
      Company.find({ isActive: { $ne: false } }).sort({ alias: 1 }),
      User.find({
        banned: { $ne: true },
        isServiceAccount: false,
        "company.isActive": { $ne: false },
      }).sort({
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

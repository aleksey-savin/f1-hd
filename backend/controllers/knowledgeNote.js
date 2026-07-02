const KnowledgeNote = require("../models/knowledgeNote");
const Company = require("../models/company");
const User = require("../models/user");
const TicketCategory = require("../models/ticketCategory");
const Preferences = require("../models/preferences");

const { AppError } = require("../middleware/errorHandling");
const getAuthData = require("../middleware/getAuthData");
const { markdownToPlainText } = require("../helpers/markdownToPlainText");
const { scanNote } = require("../services/secretsScanner");
const { parseServiceTables } = require("../services/serviceExpiryScanner");
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
    moderatorIds: (kb.moderators || [])
      .map((moderator) => moderator?._id?.toString())
      .filter(Boolean),
  };
};

// Пересчитать производные поля заметки (секреты + продление услуг) сразу после
// создания/правки, чтобы они не оставались устаревшими до соответствующего крона.
// Семантика крона сохранена: каждый блок — no-op без своего флага; для секретов
// сохраняем ignoredHashes (список «не секрет» модератора). Мутирует note; вызывать
// до note.save() — сканеры читают уже обновлённые title/plainText/content.
const rescanNoteDerived = async (note) => {
  const prefs = await Preferences.findOne({}, { knowledgeBase: 1 }).lean();
  const kb = prefs?.knowledgeBase || {};
  const scannedAt = new Date();

  if (kb.scanForSecrets) {
    const ignoredHashes = note.secretsScan?.ignoredHashes || [];
    const findings = scanNote(note, ignoredHashes);
    note.secretsScan = {
      flagged: findings.length > 0,
      findings,
      ignoredHashes,
      scannedAt,
    };
  }

  // Крон разбора услуг пропускает архивные заметки — повторяем это здесь
  if (kb.trackServiceExpiry && !note.archivedAt) {
    note.serviceExpiry = {
      entries: parseServiceTables(note.content),
      scannedAt,
    };
  }
};

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

    const notes = await KnowledgeNote.find(filter, { content: 0 })
      .sort({ updatedAt: -1 })
      .lean();

    const visibleNotes = notes.filter((note) =>
      canViewNote(note, authedUser, kbConfig),
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
    const authedUser = await getAuthData(req);
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
        canViewNote(note, authedUser, kbConfig) &&
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
    const authedUser = await getAuthData(req);
    const kbConfig = await getKbConfig();
    const note = await KnowledgeNote.findById(req.params.id).lean();

    if (!note) {
      return next(
        new AppError(`Заметка с id ${req.params.id} не найдена`, 404),
      );
    }

    if (!canViewNote(note, authedUser, kbConfig)) {
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

    await rescanNoteDerived(note);
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
    // Любое изменение сбрасывает одобрение — заметку нужно повторно одобрить
    note.approved = false;
    note.approvedBy = undefined;
    note.approvedAt = undefined;
    // Заново пересчитываем секреты и услуги на свежем тексте, чтобы статусы
    // не висели устаревшими до кронов после правки содержимого заметки
    await rescanNoteDerived(note);

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

// Отправить заметку на удаление (мягко): ждёт подтверждения модератора.
// Доступно носителям canManageKnowledgeBase.
exports.sendToDeletion = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
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
    const authedUser = await getAuthData(req);
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
    const authedUser = await getAuthData(req);
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

// Одобрить заметку. Только модераторы. Требуются оба подтверждения из диалога.
exports.approve = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);
    const { moderatorIds } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return next(
        new AppError(
          `Недостаточно прав: одобрять заметки могут только модераторы`,
          403,
        ),
      );
    }

    const { confirmCurrent, confirmNoSecrets } = req.body;
    if (confirmCurrent !== true || confirmNoSecrets !== true) {
      return next(
        new AppError(`Необходимо подтвердить оба условия одобрения`, 422),
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

    res.status(200).json({ message: "Заметка одобрена", note });
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
// Доступно носителям canManageKnowledgeBase.
exports.requestArchive = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
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
    const authedUser = await getAuthData(req);
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
    const authedUser = await getAuthData(req);
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

// Восстановить заметку из архива. Доступно носителям canManageKnowledgeBase.
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

// Сводка для модератора: счётчики для карточки на странице заявок и алерта.
// Немодераторам возвращаем нули.
exports.getModerationSummary = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);
    const { moderatorIds } = await getKbConfig();

    if (!isModerator(authedUser, moderatorIds)) {
      return res.status(200).json({
        isModerator: false,
        pendingApproval: 0,
        pendingDeletion: 0,
        pendingArchive: 0,
        secretsFlagged: 0,
      });
    }

    // Архивные заметки исключаем из счётчиков (они «исчезли»), кроме секретов —
    // утечку нужно видеть и в архиве.
    const [pendingApproval, pendingDeletion, pendingArchive, secretsFlagged] =
      await Promise.all([
        KnowledgeNote.countDocuments({
          approved: { $ne: true },
          archivedAt: null,
        }),
        KnowledgeNote.countDocuments({ pendingDeletion: true, archivedAt: null }),
        KnowledgeNote.countDocuments({ pendingArchive: true, archivedAt: null }),
        KnowledgeNote.countDocuments({ "secretsScan.flagged": true }),
      ]);

    res.status(200).json({
      isModerator: true,
      pendingApproval,
      pendingDeletion,
      pendingArchive,
      secretsFlagged,
    });
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
// Для карточки на странице заявок; доступно всем с canSeeKnowledgeBase.
exports.getServiceExpiry = async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({}).lean();
    const kb = prefs?.knowledgeBase || {};

    if (!kb.trackServiceExpiry) {
      return res.status(200).json({ services: [], count: 0 });
    }

    const days = kb.serviceExpiryDays > 0 ? kb.serviceExpiryDays : 30;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const notes = await KnowledgeNote.find(
      { archivedAt: null, "serviceExpiry.entries.expiresAt": { $lte: cutoff } },
      { title: 1, serviceExpiry: 1, categories: 1 },
    ).lean();

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
    const authedUser = await getAuthData(req);
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

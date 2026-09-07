const storage = require("../services/storage");

const { AppError } = require("../middleware/errorHandling");
const logger = require("../utils/logger");

const Preferences = require("../models//preferences");

const { Ticket } = require("../models/ticket");
const { isStaleVersion, sendConflict } = require("../helpers/ticketVersion");
const {
  resolveActor: resolveTelegramActor,
} = require("../services/telegramActor");
const { deriveTicketTitle } = require("../helpers/deriveTicketTitle");
const { resolveGetScreenApiKey } = require("../helpers/getScreenKey");
const User = require("../models//user");
const Company = require("../models/company");
const Category = require("../models/ticketCategory");
const TicketLog = require("../models/ticketLog");
const Work = require("../models/work");
const Comment = require("../models/comment");
const CompanyLog = require("../models/companyLog");

const Connection = require("../models/pro32Connect/connection");

const {
  generateTicketAiGuide,
  expireStalePendingGuide,
} = require("../services/ticketAiGuide");
const {
  analyzeTicketTerms,
  buildTermReference,
  saveReferenceAsNote,
  expireStalePendingTerms,
} = require("../services/ticketAiTerms");
const AiFeedback = require("../models/aiFeedback");
const { detectTicketCategory } = require("../services/ticketCategoryService");
const { logAiTicketEvent } = require("../services/aiTicketLog");
const { humanizeAiError } = require("../services/aiErrors");
const { annotateWorks } = require("../services/workPreview");
const {
  autoApplyEnabled,
  bestTemplateForTicket,
  itemsToChecklist,
} = require("../services/checklistTemplates");
const { buildFeed, isTechnical, classify } = require("../services/ticketEvents");
const {
  isAudioAttachment,
  transcribeAttachment,
  carryOverSpeechResult,
  expireStalePendingSpeech,
} = require("../services/speechToTextService");
const { buildKnownCaller } = require("../services/callerIdentityService");
const {
  resolveClientTimezone,
  createClientTimezoneResolver,
  formatClientTimeLabel,
} = require("../services/clientTimezone");
const { resolveTimezone } = require("../utils/datetime");
const Subdivision = require("../models/subdivision");
const {
  ADDRESS_FIELDS,
  listCompanyAddresses,
  resolveClientAddress,
  subdivisionIndex,
} = require("../services/clientAddress");
const {
  permissionFilter,
  effectivePermissions,
} = require("@/services/permissions");

const buildAttachment = (file) => ({
  mimetype: file.mimetype,
  mimeType: file.mimetype,
  name: file.key,
  originalName: file.originalname,
  size: file.size,
});

/**
 * Ответственных проверяем поимённо: право «брать заявки в работу» должно быть у
 * КАЖДОГО из списка, а не подразумеваться из того, что список пришёл из формы.
 *
 * Условие собирает `permissionFilter` — с ролями флага в документе пользователя
 * нет, и прямое `{ "permissions.canPerformTickets": true }` молча вернуло бы
 * неполный список. Отказ называет людей по именам: идентификаторы человеку,
 * который его читает, ничего не говорят.
 */
const assertResponsiblesMayPerform = async (responsibles) => {
  const ids = responsibles.map((person) => person?._id).filter(Boolean);
  if (!ids.length) return;

  const filter = await permissionFilter("ticket.perform");
  const allowed = await User.find({ _id: { $in: ids }, ...filter })
    .select("_id")
    .lean();

  if (allowed.length === ids.length) return;

  const allowedIds = new Set(allowed.map((user) => user._id.toString()));
  const names = responsibles
    .filter((person) => !allowedIds.has(String(person?._id)))
    .map(
      (person) =>
        [person.lastName, person.firstName].filter(Boolean).join(" ") ||
        String(person._id),
    )
    .join(", ");

  throw new AppError(
    `Нельзя назначить ответственным: ${names} — у них нет права выполнять заявки`,
    400,
  );
};

exports.getAllOpened = async (req, res, next) => {
  try {
    const { isAdmin, userId, company } = req.auth.legacy;

    const allTickets = await Ticket.find({ isClosed: false })
      .select("-description")
      .populate({
        path: "applicantId",
        select:
          "firstName lastName email phone position role banned subdivision timezone",
        populate: {
          path: "subdivision",
          select: "name timezone parent",
        },
      })
      .populate({
        path: "comments",
        select: "content attachments createdAt createdBy",
        populate: {
          path: "createdBy",
          select: "firstName lastName ",
        },
      })
      .populate({
        path: "categoryId",
        select: "title",
      })
      .sort({
        _id: -1,
      });

    let filteredTickets = [];

    if (
      req.auth.can({
        ticket: { actions: ["administrate", "readAll"], connector: "OR" },
      })
    ) {
      // Пользователи с ролью администратор
      filteredTickets = allTickets;
    } else if (req.auth.can({ ticket: ["readCompany"] })) {
      // Пользователи с разрешением на просмотр всех заявок Компании
      filteredTickets = allTickets.filter((ticket) => {
        return ticket.company?._id?.toString() === company._id.toString();
      });
    } else {
      // Остальные пользователи
      filteredTickets = allTickets.filter((ticket) => {
        return (
          ticket.responsibles
            .map((resp) => resp._id.toString())
            .includes(userId.toString()) ||
          ticket.createdBy.toString() === userId.toString() ||
          ticket.applicantId?._id.toString() === userId.toString()
        );
      });
    }

    // Одним запросом достаём запланированные работы для всех заявок сразу и
    // группируем по заявке — вместо N+1 (отдельный Work.find на каждую заявку).
    const ticketIds = filteredTickets.map((ticket) => ticket._id);
    const allScheduledWorks = await Work.find({
      tickets: { $in: ticketIds },
      scheduled: true,
      finishedAt: null,
    });

    const worksByTicket = new Map();
    for (const work of allScheduledWorks) {
      for (const tId of work.tickets) {
        const key = tId.toString();
        if (!worksByTicket.has(key)) worksByTicket.set(key, []);
        worksByTicket.get(key).push(work);
      }
    }

    // Лёгкий запрос: множество заявок, у которых есть хотя бы одна завершённая
    // работа. Нужно фронту, чтобы заранее знать, можно ли массово закрыть заявку
    // (закрытие требует указанных работ) и блокировать кнопку с пояснением.
    const finishedWorkTicketIds = await Work.find({
      tickets: { $in: ticketIds },
      finishedAt: { $ne: null },
    }).distinct("tickets");
    const finishedSet = new Set(
      finishedWorkTicketIds.map((id) => id.toString()),
    );

    // Пояс клиента на всю страницу разом: подразделения и компании грузятся
    // пачкой, каскад считается в памяти — иначе был бы запрос на строку.
    const clientTimezoneOf = await createClientTimezoneResolver({
      preferences: await Preferences.findOne({}),
      companyIds: filteredTickets.map((ticket) => ticket.company?._id),
    });

    const shortenedTickets = filteredTickets.map((ticket) => ({
      _id: ticket._id,
      num: ticket.num,
      company: ticket.company,
      clientTimezone: clientTimezoneOf({
        user: ticket.applicantId,
        subdivision: ticket.applicantId?.subdivision,
        companyId: ticket.company?._id,
      }),
      category: ticket.categoryId || ticket.category,
      title: ticket.title,
      attachments: ticket.attachments,
      applicant: ticket.applicantId || ticket.applicant,
      responsibles: ticket.responsibles,
      createdAt: ticket.createdAt,
      deadline: ticket.deadline,
      finishedAt: ticket.finishedAt,
      isClosed: ticket.isClosed,
      state: ticket.state,
      latestComment: ticket.comments[ticket.comments.length - 1],
      // Счётчик переписки — тихий значок в строке списка: диспетчер видит, что по
      // заявке уже общались, не открывая её. Отдаём число, а не массив: тексты
      // комментариев списку не нужны.
      commentsCount: ticket.comments.length,
      scheduledWorks: worksByTicket.get(ticket._id.toString()) || [],
      hasFinishedWorks: finishedSet.has(ticket._id.toString()),
      routineTask: ticket.routineTask,
      aiSpeech: ticket.aiSpeech,
      aiCategory: ticket.aiCategory,
    }));

    res.status(200).json({ tickets: shortenedTickets });
  } catch (error) {
    next(new AppError("Failed to fetch opened tickets", 500, true, error));
  }
};

exports.getUsersTickets = async (req, res, next) => {
  const contextLogger = await logger.addContext(req);
  try {
    const authedUser = req.auth?.legacy ?? null;

    const { isAdmin, userId } = authedUser;

    let tickets = [];

    contextLogger.log("info", "Fetching user's tickets");

    if (
      req.auth.can({
        ticket: { actions: ["administrate", "readAll"], connector: "OR" },
      })
    ) {
      // Пользователи с ролью администратор
      tickets = await Ticket.find({
        "applicant._id": req.params.id,
      }).sort({ lastName: 1 });
    } else {
      // Остальные пользователи
      tickets = await Ticket.find({
        $and: [
          { "responsibles._id": userId },
          { "applicant._id": req.params.id },
        ],
      }).sort({
        _id: -1,
      });
    }

    const shortenedTickets = tickets.map((ticket) => {
      return {
        _id: ticket._id,
        num: ticket.num,
        title: ticket.title,
        state: ticket.state,
        createdAt: ticket.createdAt,
      };
    });

    contextLogger.log(
      "info",
      `Returning ${shortenedTickets.length} user's tickets`,
    );

    res.status(200).json(shortenedTickets);
  } catch (error) {
    next(new AppError(`Failed to fetch user's tickets`, 500, true, error));
  }
};

// ── Архив закрытых заявок: серверная выборка ────────────────────────────────
// Поиск, фасеты, сортировка и постраничность считает БД (канон «Список на
// серверной выборке»; эталон пагинации — user.getAll).

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OBJECT_ID_RX = /^[0-9a-fA-F]{24}$/;
const parseIdList = (value) =>
  String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => OBJECT_ID_RX.test(id));

const CLOSED_PAGE_LIMIT_DEFAULT = 50;
const CLOSED_PAGE_LIMIT_MAX = 100;
const CLOSED_SORT = {
  finished_desc: { finishedAt: -1, _id: -1 },
  finished_asc: { finishedAt: 1, _id: 1 },
  created_desc: { createdAt: -1, _id: -1 },
};

exports.getClosed = async (req, res, next) => {
  try {
    const {
      _id: userId,
      isAdmin,
      permissions,
      company,
    } = req.auth.legacy;
    const q = req.query;

    const query = { isClosed: true };
    const and = [];

    // Период по дате закрытия: календарные дни yyyy-MM-dd, обе границы
    // необязательны; конец — эксклюзивно следующим днём, чтобы включить весь
    // день `to`
    const fromDate = q.from ? new Date(q.from) : null;
    if (fromDate && !isNaN(fromDate)) {
      query.finishedAt = { ...(query.finishedAt || {}), $gte: fromDate };
    }
    const toDate = q.to ? new Date(q.to) : null;
    if (toDate && !isNaN(toDate)) {
      toDate.setDate(toDate.getDate() + 1);
      query.finishedAt = { ...(query.finishedAt || {}), $lt: toDate };
    }

    const companies = parseIdList(q.companies);
    if (companies.length) query["company._id"] = { $in: companies };
    const responsibles = parseIdList(q.responsibles);
    if (responsibles.length) query["responsibles._id"] = { $in: responsibles };
    const categories = parseIdList(q.categories);
    if (categories.length) query.categoryId = { $in: categories };
    const applicants = parseIdList(q.applicants);
    if (applicants.length) query.applicantId = { $in: applicants };

    // Скоуп прав — те же ярусы, что у getAllOpened: админ и
    // canSeeAll* видят всё; canSeeAllCompanyTickets — только своя компания
    // (жёстче фильтра компаний из запроса); остальные — заявки, в которых
    // участвовали (ответственный, автор или заявитель)
    if (
      req.auth.can({
        ticket: { actions: ["administrate", "readAll"], connector: "OR" },
      })
    ) {
      // без ограничений
    } else if (req.auth.can({ ticket: ["readCompany"] })) {
      query["company._id"] = company._id;
    } else {
      and.push({
        $or: [
          { "responsibles._id": userId },
          { createdBy: userId },
          { applicantId: userId },
        ],
      });
    }

    // Поиск: AND по термам (до 6, терм ≤ 64 символов); терм ищется по номеру
    // (целиком цифры — точное совпадение), теме, описанию и ФИО инициатора.
    // Имена — предзапросом в User: у старых заявок embedded applicant пуст,
    // надёжен только ref applicantId
    const searchTerms = String(q.search || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    for (const term of searchTerms) {
      const rx = new RegExp(escapeRegex(term.slice(0, 64)), "i");
      const or = [{ title: rx }, { description: rx }];
      if (/^\d+$/.test(term)) or.push({ num: Number(term) });
      const namesakes = await User.find({
        $or: [{ firstName: rx }, { lastName: rx }],
      })
        .select("_id")
        .lean();
      if (namesakes.length) {
        or.push({ applicantId: { $in: namesakes.map((user) => user._id) } });
      }
      and.push({ $or: or });
    }

    if (and.length) query.$and = and;

    const limit = Math.min(
      Math.max(Number(q.limit) || CLOSED_PAGE_LIMIT_DEFAULT, 1),
      CLOSED_PAGE_LIMIT_MAX,
    );
    const page = Math.max(Number(q.page) || 1, 1);
    const sort = CLOSED_SORT[q.sort] || CLOSED_SORT.finished_desc;

    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .select(
          "num title company categoryId applicantId applicant responsibles createdAt finishedAt routineTask",
        )
        .populate({ path: "categoryId", select: "title" })
        .populate({ path: "applicantId", select: "firstName lastName" })
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Ticket.countDocuments(query),
    ]);

    const transformedTickets = tickets.map((ticket) => ({
      _id: ticket._id,
      num: ticket.num,
      title: ticket.title,
      company: ticket.company,
      category: ticket.categoryId,
      applicant: ticket.applicantId || ticket.applicant || null,
      responsibles: (ticket.responsibles || []).map((responsible) => ({
        _id: responsible._id,
        firstName: responsible.firstName,
        lastName: responsible.lastName,
      })),
      createdAt: ticket.createdAt,
      finishedAt: ticket.finishedAt,
      isRoutine: Boolean(ticket.routineTask),
    }));

    res.status(200).json({ tickets: transformedTickets, total, page, limit });
  } catch (error) {
    next(new AppError("Failed to fetch closed tickets", 500, true, error));
  }
};


/**
 * Служебные записи лога за окно времени — раскрытие свёрнутой группы в хронике
 * («6 уведомлений · 2 не доставлены»). Отдельным запросом, потому что этих
 * записей у заявки бывают тысячи, а смотрят их редко.
 */
exports.getTechnicalLog = async (req, res, next) => {
  try {
    const { isEndUser } = req.auth;
    if (isEndUser) return res.status(200).json({ entries: [] });

    const ticket = await Ticket.findOne({ num: req.params.ticketNum })
      .select("_id num")
      .lean();
    if (!ticket) return next(new AppError("Ticket not found", 404));

    const range = {};
    if (req.query.from) range.$gte = new Date(req.query.from);
    if (req.query.to) range.$lte = new Date(req.query.to);

    const entries = await TicketLog.find({
      $or: [{ ticket: ticket.num }, { ticketId: ticket._id }],
      ...(range.$gte || range.$lte ? { createdAt: range } : {}),
    })
      .select("kind event user severity createdAt files")
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    res.status(200).json({
      entries: entries.filter((entry) =>
        isTechnical(entry.kind || classify(entry.event)),
      ),
    });
  } catch (error) {
    next(new AppError("Failed to fetch ticket log", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const { isEndUser, isAdmin, permissions } = req.auth;
    const ticketNum = req.params.ticketNum;

    const ticket = await Ticket.findOne({ num: ticketNum })
      // Чек-лист заявки почти всегда приезжает из регламента — секция называет
      // источник и ссылается на него: править пункты для будущих заявок нужно
      // там, а не здесь
      .populate({ path: "routineTask", select: "title" })
      .populate({
        path: "applicantId",
        select:
          "firstName lastName email phone position role banned subdivision activeDirectoryObjectGUID timezone",
        populate: {
          path: "subdivision",
          select: "name email address phone linkToMap timezone parent",
        },
      })
      .populate({
        path: "comments",
        populate: {
          path: "createdBy",
          select: "profileImagePath lastName firstName",
        },
      })
      .populate({
        path: "categoryId",
        select: "title alwaysWithinPlan users",
      })
      .transform((doc) => {
        doc = doc.toObject();
        doc.applicant = doc.applicantId;
        doc.category = doc.categoryId;
        delete doc.applicantId;
        delete doc.categoryId;
        // AI guide is an internal aid — never expose it to end-users/clients.
        if (isEndUser) delete doc.aiGuide;
        return doc;
      });

    // Фоновая работа, убитая перезапуском процесса, остаётся в pending — а
    // карточка опрашивает именно этот ответ. Гасим просроченное здесь, чтобы у
    // неё был выход из вечного ожидания: у руководства ИИ и у расшифровок
    // вложений болезнь одна.
    await expireStalePendingGuide(ticket);
    await expireStalePendingSpeech(ticket);
    await expireStalePendingTerms(ticket);

    // Форме правки нужна одна заявка, и всегда свежая: её правят многие и
    // часто. Компания с людьми, журналы, работы и хроника ниже — данные
    // карточки, форма их не читает; `?view=form` отвечает сразу после них,
    // и шторка формы открывается без лишних выборок.
    if (req.query.view === "form") {
      return res.status(200).json({ message: "Ticket fetched", ticket });
    }

    // У заявки может не быть компании (легаси-данные): toObject() с minimize
    // вырезает пустой объект company — без ?. карточка падала бы в 500.
    const company = await Company.findById(ticket.company?._id).populate({
      path: "employees",
      select: "firstName lastName email phone position banned",
      match: { banned: { $ne: true } },
    });

    // Если инициатор связан с Active Directory, подтягиваем его последний ПК
    // из логов активности компании (последняя запись входа с именем компьютера).
    if (ticket.applicant?.activeDirectoryObjectGUID) {
      const lastLog = await CompanyLog.findOne({
        activeDirectoryObjectGUID: ticket.applicant.activeDirectoryObjectGUID,
        computerName: { $nin: [null, ""] },
      })
        .sort({ createdAt: -1 })
        .select("computerName activeDirectoryLogin createdAt")
        .lean();

      if (lastLog) {
        ticket.applicant.computer = {
          name: lastLog.computerName,
          activeDirectoryLogin: lastLog.activeDirectoryLogin,
          lastSeenAt: lastLog.createdAt,
        };
      }
    }

    const works = await Work.find({ tickets: ticket._id });

    // Резолвим связанные заявки каждой работы в {_id, num, title}. Форма
    // редактирования работ заполняет «Также привязать к» по work.linkedTickets,
    // а не по кандидатному списку otherCompanyTickets (он сужен до заявок той же
    // категории, где пользователь ответственный). Иначе связи с заявками вне
    // этого списка (например, другой категории при массовом добавлении работ) не
    // отображались бы и терялись при сохранении.
    const linkedTicketIds = [
      ...new Set(works.flatMap((work) => work.tickets.map((t) => t.toString()))),
    ];
    const linkedTicketDocs = await Ticket.find({
      _id: { $in: linkedTicketIds },
    }).select("num title");
    const linkedById = new Map(
      linkedTicketDocs.map((t) => [
        t._id.toString(),
        { _id: t._id, num: t.num, title: t.title },
      ]),
    );
    // Переработка и доплата по каждой работе — тем же кодом, что выставляет
    // счёт (services/workPreview → servicePlanBilling). В строке показывается
    // только исключение: у работы в рамках тарифа поля просто нет.
    const billingByWork = await annotateWorks({
      works: works.map((work) => work.toObject()),
      // Деньги видит тот, у кого и тарифы, и отчёт по сотрудникам. Двумя
      // вызовами: по И словарь складывает только действия ОДНОГО ресурса.
      canSeeMoney:
        req.auth.can({ servicePlan: ["read"] }) &&
        req.auth.can({ report: ["employees"] }),
    });

    const worksWithLinks = works.map((work) => ({
      ...work.toObject(),
      linkedTickets: work.tickets
        .map((t) => linkedById.get(t.toString()))
        .filter(Boolean),
      outOfSchedule: billingByWork[work._id.toString()] || null,
    }));

    // Хроника карточки: события заявки, служебные записи — счётчиками под
    // предыдущим событием (у одной заявки их бывает 1476 против 10 событий).
    // Тексты записей клиенту не нужны — разворачиваются по запросу через
    // GET /tickets/:num/log.
    const logs = await TicketLog.find({
      $or: [{ ticket: ticketNum }, { ticketId: ticket._id }],
    })
      .select("kind event user severity createdAt files")
      .lean();
    const events = buildFeed(logs);

    // В каком поясе живёт заявитель: специалист должен видеть, что у клиента
    // ночь, ДО того как наберёт номер. Каскад — в services/clientTimezone.
    ticket.clientTimezone = await resolveClientTimezone({
      user: ticket.applicant,
      subdivision: ticket.applicant?.subdivision,
      company,
      preferences: await Preferences.findOne({}),
    });

    // Куда ехать к заявителю: адрес его подразделения (или ближайшего родителя
    // с адресом), иначе адрес компании — каскад в services/clientAddress.
    // Компанию отдаём плоским объектом: Mongoose-документ вырезал бы поле
    // `addresses`, которого нет в схеме.
    const companyObj = company ? company.toJSON() : null;
    if (companyObj) {
      const subdivisionDocs = await Subdivision.find({ company: company._id })
        .select(ADDRESS_FIELDS)
        .lean();
      companyObj.addresses = listCompanyAddresses({
        company: companyObj,
        subdivisions: subdivisionDocs,
      });
      ticket.clientAddress = resolveClientAddress({
        subdivision: ticket.applicant?.subdivision,
        company: companyObj,
        subdivisionById: subdivisionIndex(subdivisionDocs),
      });
    } else {
      ticket.clientAddress = resolveClientAddress({ subdivision: null });
    }

    res.status(200).json({
      message: "Ticket fetched",
      ticket: ticket,
      company: companyObj || {},
      works: worksWithLinks,
      events: isEndUser ? [] : events,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch ticket ${req.params.ticketNum}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.getFormData = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;

    // По умолчанию отключённые компании (и их заявители) в форму не попадают;
    // Архив заявок шлёт ?includeInactive=true — там фильтруют по истории.
    const includeInactive = req.query.includeInactive === "true";
    const companyActive = includeInactive ? {} : { isActive: { $ne: false } };
    const applicantCompanyActive = includeInactive
      ? {}
      : { "company.isActive": { $ne: false } };

    let companies = [];
    let applicants = [];
    let categories = [];
    let responsibles = [];

    // Форма открывается по готовности этих данных, поэтому независимые
    // выборки идут параллельно, а не одна за другой
    const performers = () =>
      permissionFilter("ticket.perform").then((filter) =>
        User.find({ $and: [filter, { banned: { $ne: true } }] }).sort({
          lastName: 1,
        }),
      );

    if (authedUser.isEndUser) {
      [companies, responsibles, categories, applicants] = await Promise.all([
        Company.find({ _id: authedUser.company._id }).sort({ alias: 1 }),
        performers(),
        // Полный активный каталог: фасет категорий в архиве (сегменты «Заявки»
        // и «Работы») у конечного пользователя раньше оставался пустым
        Category.find({ isActive: true }).sort({ title: 1 }),
        req.auth.can({ ticket: ["readCompany"] })
          ? User.find({
              "company._id": authedUser.company._id,
              isServiceAccount: false,
              banned: { $ne: true },
            })
          : [authedUser],
      ]);
    } else if (req.auth.can({ ticket: ["administrate"] })) {
      [companies, applicants, categories, responsibles] = await Promise.all([
        Company.find({
          "responsibles._id": authedUser._id,
          ...companyActive,
        }).sort({ alias: 1 }),
        User.find({
          $and: [{ banned: { $ne: true } }, { isServiceAccount: false }],
          ...applicantCompanyActive,
        }).sort({ lastName: 1 }),
        Category.find({ isActive: true }).sort({ title: 1 }),
        performers(),
      ]);
    } else {
      [[companies, applicants], categories, responsibles] = await Promise.all([
        // applicants наследуют фильтр активности от уже отфильтрованных
        // companies — эта пара последовательна, остальное параллельно
        Company.find({
          "responsibles._id": authedUser._id,
          ...companyActive,
        })
          .sort({ alias: 1 })
          .then(async (found) => [
            found,
            await User.find({
              "company._id": { $in: found },
              banned: { $ne: true },
            }).sort({ lastName: 1 }),
          ]),
        Category.find({
          banned: { $ne: true },
          _id: { $in: authedUser.categories },
        }).sort({ title: 1 }),
        User.find({ _id: authedUser._id }).sort({ lastName: 1 }),
      ]);
    }

    res.status(200).json({
      message: "Form data fetched successfully",
      companies: companies.map((company) => ({
        _id: company._id,
        alias: company.alias,
      })),
      applicants: applicants.map((applicant) => ({
        _id: applicant._id,
        lastName: applicant.lastName,
        firstName: applicant.firstName,
        company: applicant.company,
        permissions: applicant.permissions,
      })),

      // description объясняет, что попадает в категорию, и показывается
      // подсказкой под полем; users отвечают, кто эту категорию ведёт, и делят
      // список ответственных на две группы. Без них форма годами показывала
      // «У данной категории нет описания» при заполненном описании у всех
      // категорий и ни разу не подсвечивала «своего» исполнителя.
      categories: categories.map((category) => ({
        _id: category._id,
        title: category.title,
        description: category.description || "",
        users: (category.users || []).map((user) => user._id ?? user),
      })),
      responsibles: responsibles.map((resp) => ({
        _id: resp._id,
        lastName: resp.lastName,
        firstName: resp.firstName,
      })),
    });
  } catch (error) {
    next(new AppError(`Failed to fetch ticket form data`, 500, true, error));
  }
};

exports.add = async (req, res, next) => {
  try {
    const { userId, company } = req.auth.legacy;
    const { categoryId } = req.body;
    const prefs = await Preferences.findOne({});
    const userCompany = await Company.findById(company._id);
    const now = new Date();

    /**
     * Заявку от ЧУЖОГО имени и по чужой компании заводит только тот, кому это
     * разрешено. Полей «инициатор», «компания» и «ответственные» в форме
     * клиента нет вовсе (`TicketFormFields.jsx:188`), но до этой проверки любой
     * авторизованный мог прислать их запросом — и завести заявку от чужого
     * лица, на чужую компанию и с чужими ответственными.
     *
     * Право, а не признак «сотрудник»: заводить заявки за позвонившего — часть
     * обычной работы поддержки, но именно поэтому его должно быть видно в роли
     * и можно отобрать. Оно есть у всех ролей сотрудников.
     */
    const onBehalfOfOthers = req.auth.can({ ticket: ["createForOthers"] });

    const applicant =
      onBehalfOfOthers && req.body.applicantId
        ? req.body.applicantId
        : userId;

    const attachments = req.files?.map(buildAttachment);

    const customFields = req.body.customFields
      ? JSON.parse(req.body.customFields)
      : [];

    const validCustomFields = customFields.filter(
      (field) => field && field.name,
    );

    const parsedTemplate = req.body.template
      ? JSON.parse(req.body.template)
      : null;
    // Чек-лист-заготовка шаблона копируется в заявку (обязательность сохраняется).
    let templateChecklist = (parsedTemplate?.checklist || []).map((item) => ({
      description: item.description,
      checked: false,
      mandatory: !!item.mandatory,
    }));

    // Свой чек-лист шаблона заявки сильнее подбора: он часть заготовки, по
    // которой заявку и создают. Подбор шаблона чек-листа работает там, где
    // списка нет, — то есть в 90 % заявок, создаваемых вручную
    const ticketCompany =
      onBehalfOfOthers && req.body.company
        ? JSON.parse(req.body.company)
        : userCompany;

    const responsibles = onBehalfOfOthers
      ? JSON.parse(req.body.responsibles || "[]")
      : [];
    await assertResponsiblesMayPerform(responsibles);

    if (templateChecklist.length === 0 && (await autoApplyEnabled())) {
      const best = await bestTemplateForTicket({
        categoryId,
        company: ticketCompany,
      });
      if (best) {
        templateChecklist = itemsToChecklist(best);
      }
    }

    // Тему выводит сервер, а не браузер: у заявителя поля «Тема» нет, а тема
    // уезжает в список, в письмо, в Telegram и в отчёты. Прежняя обрезка на
    // клиенте (`substring(0, 50)`) давала 684 темы ровно в 50 знаков из 884
    // клиентских заявок за год — оборванных посреди слова.
    const submittedTitle = (req.body.title || "").trim();
    const title = submittedTitle || deriveTicketTitle(req.body.description);
    // Тему, выведенную из текста, может переписать ассистент — тем же проходом,
    // которым он подбирает категорию. Провизорную тему всё равно сохраняем:
    // уведомления уходят в момент создания, безымянной заявки быть не должно.
    //
    // Условие повторяет условие запуска прохода (ниже: ИИ включён и категории
    // нет). Иначе заявка с категорией, но без темы получила бы вечный pending:
    // проход для неё не стартует. На практике это одно и то же множество —
    // темы не заполняет только заявитель, а категорию он и не выбирает.
    const wantsAiTitle =
      !!prefs?.ai?.isActive && !categoryId && !submittedTitle && !!title;

    const ticket = new Ticket({
      title,
      description: req.body.description,
      template: parsedTemplate,
      checklist: templateChecklist,
      customFields: validCustomFields,
      attachments: attachments,
      isClosed: false,
      categoryId: categoryId,
      // Заявитель либо авторизованный пользователь, либо указанный в полной форме создания заявки
      applicantId: applicant,
      company: ticketCompany,
      responsibles: responsibles,
      deadline: req.body.deadline
        ? req.body.deadline
        : now.setTime(now.getTime() + prefs.deadline * 60 * 60 * 1000),
      state: req.body.state,
      source: req.body.source,
      createdBy: userId,
      updatedBy: userId,
      notifications: {
        lastAction: "new ticket",
        pending: true,
      },
      // Если категория не выбрана и ИИ включён — помечаем заявку ожидающей
      // автоопределения категории (бейдж статуса появится сразу).
      ...(prefs?.ai?.isActive && !categoryId
        ? { aiCategory: { status: "pending" } }
        : {}),
      ...(wantsAiTitle ? { aiTitle: { status: "pending" } } : {}),
    });

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: applicant.firstName,
        lastName: applicant.lastName,
      },
      severity: "info",
      event: "создана новая заявка",
    });
    await logEntry.save();

    res.status(201).json({
      message: "Ticket added successfully!",
      ticket: ticket,
    });

    // В фоне (ответ 201 уже отправлен): определяем категорию, если она не выбрана.
    // AI-руководство при создании не генерируется — только вручную со страницы
    // заявки (regenerateAiGuide). Создание заявки не блокируется и не падает.
    if (prefs?.ai?.isActive && !categoryId) {
      detectTicketCategory(ticket._id).catch((error) =>
        logger.log("error", "Background AI ticket processing failed", {
          ticketId: ticket._id.toString(),
          error: error.message,
        }),
      );
    }
  } catch (error) {
    if (req.files) {
      for (let file of req.files) {
        storage.deleteObject(file.key).catch((error) =>
          logger.log("error", "Failed to delete file", {
            error: error.message,
            stack: error.stack,
          }),
        );
      }
    }
    // Отказ по составу заявки — это 400, а не сбой сервера
    next(
      error instanceof AppError
        ? error
        : new AppError(`Failed to add ticket`, 500, true, error),
    );
  }
};

exports.regenerateAiGuide = async (req, res, next) => {
  try {
    const { _id } = req.body;

    const ticket = await Ticket.findById(_id).select("_id");
    if (!ticket) {
      return next(new AppError(`Ticket not found`, 404, true));
    }

    // Ошибку прошлой попытки чистим сразу: она пережила бы сборку и всплыла бы
    // как причина уже в новом результате. startedAt — срок жизни pending
    await Ticket.findByIdAndUpdate(_id, {
      "aiGuide.status": "pending",
      "aiGuide.startedAt": new Date(),
      "aiGuide.error": "",
    });

    const aiGuide = await generateTicketAiGuide(_id);

    if (aiGuide?.status === "error") {
      return next(
        new AppError(aiGuide.error || "Failed to generate AI guide", 502, true),
      );
    }

    res.status(200).json({
      message: "AI guide regenerated",
      aiGuide,
    });
  } catch (error) {
    next(new AppError(`Failed to regenerate AI guide`, 500, true, error));
  }
};

// ── Понятийный аппарат заявки ─────────────────────────────────────────────
// Разбор и справка — по требованию: платить вызовом модели за каждую созданную
// заявку незачем, к предмету вопрос возникает у единиц.

exports.analyzeAiTerms = async (req, res, next) => {
  try {
    const { _id } = req.body;

    const ticket = await Ticket.findById(_id).select("_id");
    if (!ticket) {
      return next(new AppError(`Ticket not found`, 404, true));
    }

    const aiTerms = await analyzeTicketTerms(_id);

    if (aiTerms?.status === "error") {
      return next(
        new AppError(aiTerms.error || "Failed to analyze ticket", 502, true),
      );
    }

    res.status(200).json({ message: "Ticket analyzed", aiTerms });
  } catch (error) {
    next(new AppError(`Failed to analyze ticket terms`, 500, true, error));
  }
};

exports.getAiTermReference = async (req, res, next) => {
  try {
    const { _id, term } = req.body;

    if (!String(term || "").trim()) {
      return next(new AppError(`Term is required`, 400, true));
    }

    res.status(200).json({ item: await buildTermReference(_id, term) });
  } catch (error) {
    // Наружу — человеческая причина: сырой ответ поставщика остаётся в логе
    if (error?.statusCode === 404) return next(error);
    next(
      new AppError(
        humanizeAiError(error, "не удалось составить справку"),
        502,
        true,
        error,
      ),
    );
  }
};

// Справка про предмет, а не про заявку, — поэтому её место в базе знаний.
// Заметка создаётся неодобренной, как любая другая: модерация и есть тот
// человек, который отделяет проверенное знание от предположения модели.
exports.saveAiTermNote = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const { _id, term } = req.body;

    const note = await saveReferenceAsNote(_id, term, userId);

    res.status(201).json({
      message: "Справка сохранена в базу знаний",
      note: { _id: note._id, title: note.title, type: note.type },
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(new AppError(`Failed to save term reference`, 500, true, error));
  }
};

// ── Замечание к работе ИИ ─────────────────────────────────────────────────
// Не «палец вниз»: из «не понравилось» правила не составишь. Причина
// обязательна, текст объясняет, как правильно, а областью становится категория
// и компания заявки. В промпты замечание попадёт, только когда администратор
// включит его в настройках (services/aiRules.js).
const FEEDBACK_TARGETS = ["description", "category", "title"];
const FEEDBACK_REASONS = ["offtopic", "facts", "invented", "outdated"];
const TARGET_LABEL = {
  description: "описанию, собранному ИИ",
  category: "подбору категории",
  title: "теме, написанной ИИ",
};

exports.addAiFeedback = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { _id, target, reason, text } = req.body;

    if (!FEEDBACK_TARGETS.includes(target)) {
      return next(new AppError(`Unknown feedback target`, 400, true));
    }
    if (!FEEDBACK_REASONS.includes(reason)) {
      return next(
        new AppError("Выберите, что именно не так", 422, true),
      );
    }
    if (!String(text || "").trim()) {
      return next(
        new AppError(
          "Опишите, что неверно и как правильно — из одной пометки правило не составить",
          422,
          true,
        ),
      );
    }

    const ticket = await Ticket.findById(_id)
      .select("num categoryId company")
      .populate({ path: "categoryId", select: "title" });
    if (!ticket) {
      return next(new AppError(`Ticket not found`, 404, true));
    }

    const feedback = await new AiFeedback({
      ticketId: ticket._id,
      ticketNum: ticket.num,
      target,
      reason,
      text: String(text).trim(),
      category: ticket.categoryId?._id
        ? { _id: ticket.categoryId._id, title: ticket.categoryId.title }
        : undefined,
      company: ticket.company?._id
        ? { _id: ticket.company._id, alias: ticket.company.alias }
        : undefined,
      createdBy: {
        _id: authedUser._id,
        firstName: authedUser.firstName,
        lastName: authedUser.lastName,
      },
    }).save();

    // В хронику — сразу: замечание относится к этой заявке и объясняет, почему
    // её содержимое пришлось поправить
    await logAiTicketEvent(
      ticket._id,
      `Замечание к ${TARGET_LABEL[target]}: ${feedback.text}`,
      "warning",
    );

    res.status(201).json({
      message:
        "Замечание записано. В работу ИИ оно пойдёт, когда администратор включит его в настройках",
      feedback: { _id: feedback._id, target, reason },
    });
  } catch (error) {
    next(new AppError(`Failed to save AI feedback`, 500, true, error));
  }
};

exports.transcribeAttachment = async (req, res, next) => {
  let ticket;
  let attachmentIndex = -1;

  try {
    const { ticketNum } = req.params;
    const { attachmentName } = req.body;

    if (!attachmentName) {
      return next(new AppError("Attachment name is required", 400, true));
    }

    ticket = await Ticket.findOne({ num: ticketNum });
    if (!ticket) {
      return next(new AppError("Ticket not found", 404, true));
    }

    attachmentIndex = ticket.attachments.findIndex(
      (attachment) => attachment.name === attachmentName,
    );

    if (attachmentIndex === -1) {
      return next(new AppError("Attachment not found", 404, true));
    }

    if (!isAudioAttachment(ticket.attachments[attachmentIndex])) {
      return next(
        new AppError("Attachment is not a supported audio file", 400, true),
      );
    }

    ticket.attachments[attachmentIndex].speechToText = {
      ...carryOverSpeechResult(
        ticket.attachments[attachmentIndex].speechToText,
      ),
      status: "pending",
      error: "",
      startedAt: new Date(),
    };
    ticket.markModified("attachments");
    await ticket.save();

    await logAiTicketEvent(ticket._id, "начал распознавание записи звонка");

    // Достоверные имя клиента и компания (если опознаны) — для исправления
    // искажённых распознаванием имён в диалоге и итоге.
    const prefs = await Preferences.findOne({});
    const knownContext = await buildKnownCaller(ticket, prefs);

    const result = await transcribeAttachment(
      ticket.attachments[attachmentIndex],
      knownContext,
    );

    ticket = await Ticket.findOne({ num: ticketNum });
    attachmentIndex = ticket.attachments.findIndex(
      (attachment) => attachment.name === attachmentName,
    );

    ticket.attachments[attachmentIndex].speechToText = {
      status: "ready",
      text: result.text,
      summary: result.summary,
      segments: result.segments,
      model: result.model,
      error: "",
      generatedAt: result.generatedAt,
    };
    ticket.markModified("attachments");
    await ticket.save();

    await logAiTicketEvent(ticket._id, "завершил распознавание записи звонка");

    // ASR прошёл, но AI-итог/заголовок не сформированы — фиксируем сбой в логе
    // заявки и отдаём причину наружу, а не рапортуем чистый успех.
    if (result.summaryError) {
      await logAiTicketEvent(
        ticket._id,
        `не удалось сформировать AI-итог и заголовок: ${result.summaryError}`,
        "danger",
      );
    }

    res.status(200).json({
      success: true,
      message: "Speech recognition completed",
      attachment: ticket.attachments[attachmentIndex],
      attachments: ticket.attachments,
      summaryError: result.summaryError || "",
    });
  } catch (error) {
    if (ticket && attachmentIndex >= 0) {
      // Наружу — человеческая причина: сырой ответ поставщика уезжал и в тост,
      // и в хронику заявки, вместе с префиксом ключа
      const reason = humanizeAiError(error, "не удалось распознать запись");

      ticket.attachments[attachmentIndex].speechToText = {
        ...carryOverSpeechResult(
          ticket.attachments[attachmentIndex].speechToText,
        ),
        status: "error",
        error: reason,
        generatedAt: new Date(),
      };
      ticket.markModified("attachments");
      await ticket.save().catch((saveError) =>
        logger.log("error", "Failed to save speech recognition error", {
          error: saveError.message,
          stack: saveError.stack,
        }),
      );

      await logAiTicketEvent(
        ticket._id,
        `Ошибка распознавания записи звонка: ${reason}`,
        "danger",
      );

      return res.status(error.statusCode || 500).json({
        success: false,
        message: reason,
        attachment: ticket.attachments[attachmentIndex],
        attachments: ticket.attachments,
      });
    }

    next(new AppError(`Failed to recognize speech`, 500, true, error));
  }
};

exports.process = async (req, res, next) => {
  try {
    const {
      title,
      company,
      description,
      categoryId,
      applicantId,
      responsibles,
      deadline,
    } = req.body;

    const authData = req.auth?.legacy ?? null;

    const ticket = await Ticket.findOne({ _id: req.body._id });

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    ticket.title = title;
    ticket.company = company;
    ticket.description = description;
    ticket.categoryId = categoryId;
    ticket.applicantId = applicantId;
    ticket.responsibles = responsibles;
    ticket.deadline = deadline;
    ticket.updatedBy = authData.userId;
    ticket.processedAt = new Date();
    ticket.processedBy = authData.userId;
    ticket.state = "Не в работе";
    ticket.notifications = {
      lastAction: "process ticket",
      pending: true,
    };
    ticket.version = (ticket.version ?? 0) + 1;

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "info",
      event: "обработана заявка",
    });
    await logEntry.save();

    res.status(201).json({
      message: "Заявка успешно обработана",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to process ticket ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.takeToWork = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;

    const ticket = await Ticket.findById(req.body._id);

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    ticket.state = "В работе";
    ticket.startedAt = new Date();
    ticket.startedBy = authedUser._id;
    ticket.updatedBy = authedUser._id;
    ticket.notifications = {
      lastAction: "take ticket to work",
      pending: true,
    };

    const authedUserId = authedUser._id.toString();
    const isResponsible = ticket.responsibles.some(
      (resp) => resp._id.toString() === authedUserId,
    );

    // Пользователь добавляет себя сам — уведомлять о назначении не нужно,
    // поэтому сразу помечаем его уведомлённым. Пустой isNotified позже
    // заставил бы ветку "process ticket" прислать ему «вы назначены
    // ответственным» при первом же редактировании заявки.
    const selfAsResponsible = {
      ...authedUser,
      isNotified: { telegram: true, email: true },
    };

    if (req.body.takeOver) {
      // Взять на себя: единственным ответственным остаётся текущий пользователь.
      // Сохраняем его существующую запись (с флагами isNotified), а если заявка
      // была без ответственных — добавляем пользователя.
      const self = ticket.responsibles.find(
        (resp) => resp._id.toString() === authedUserId,
      );
      ticket.responsibles = self ? [self] : [selfAsResponsible];
    } else if (!isResponsible) {
      // Заявку принимает в работу пользователь, которого не было в ответственных
      // (например, у заявки не было ответственных) — добавляем его, чтобы заявка
      // не оказалась «В работе» без ответственных.
      ticket.responsibles = ticket.responsibles.concat(selfAsResponsible);
    }

    ticket.version = (ticket.version ?? 0) + 1;

    await ticket.save();
    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authedUser.firstName,
        lastName: authedUser.lastName,
      },
      severity: "info",
      event: "заявка принята в работу",
    });
    await logEntry.save();

    // если пользователь взял завку на себя, добавляем доп. запись в лог
    if (req.body.takeOver) {
      const logEntry = new TicketLog({
        ticketId: ticket._id,
        user: {
          firstName: authedUser.firstName,
          lastName: authedUser.lastName,
        },
        severity: "info",
        event: "взял(а) заявку на себя",
      });
      await logEntry.save();
    }

    res.status(201).json({
      message: "Ticket state updated successfully!",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to take to work ticket ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.requestHelp = async (req, res, next) => {
  try {
    const authData = req.auth?.legacy ?? null;

    const ticket = await Ticket.findById(req.body._id);

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    const filteredResponsibles = req.body.responsibles.filter((user) => {
      const respList = ticket.responsibles.map((resp) => resp._id.toString());
      if (respList.includes(user._id.toString())) {
        return false;
      }
      return true;
    });

    ticket.responsibles = ticket.responsibles.concat(filteredResponsibles);
    ticket.notifications = {
      lastAction: "request help",
      pending: true,
    };
    ticket.version = (ticket.version ?? 0) + 1;

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "info",
      event: `запросил(а) помощь, изменён список ответственных`,
    });
    await logEntry.save();

    res.status(201).json({
      message: "Пользователи добавлены в список ответственных",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to request help for ticket ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.joinResponsibles = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;

    const ticket = await Ticket.findById(req.body._id);

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    const isDuplicated = () => {
      for (let resp of ticket.responsibles) {
        if (resp._id.toString() === authedUser._id.toString()) {
          return true;
        }
      }
      return false;
    };

    const userExists = isDuplicated();

    if (userExists) {
      return res.status(201).json({
        message: "Пользователь уже находится в списке ответственных",
      });
    }

    // если до присоединения за заявкой никто не закреплён, переводим её
    // в состояние «Не в работе» (назначена, но ещё не взята в работу)
    const wasUnassigned = ticket.responsibles.length === 0;

    // Пользователь присоединяется сам — помечаем его уведомлённым, чтобы
    // ветка "process ticket" не прислала ему «вы назначены ответственным»
    // при последующем редактировании заявки.
    ticket.responsibles = ticket.responsibles.concat({
      ...authedUser,
      isNotified: { telegram: true, email: true },
    });

    if (wasUnassigned) {
      ticket.state = "Не в работе";
    }

    ticket.notifications = {
      lastAction: "join responsibles",
      pending: true,
    };
    ticket.version = (ticket.version ?? 0) + 1;

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authedUser.firstName,
        lastName: authedUser.lastName,
      },
      severity: "info",
      event: `присоединился к ответственным`,
    });
    await logEntry.save();

    res.status(201).json({
      message: "Пользователь добавлен в список ответственных",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to join responsibles for ticket ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.updateDeadline = async (req, res, next) => {
  try {
    const authData = req.auth?.legacy ?? null;

    const ticket = await Ticket.findById(req.body._id);

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    ticket.deadline = req.body.deadline;
    ticket.version = (ticket.version ?? 0) + 1;

    // Рассылка «изменён срок заявки» (категория ticketDeadlineUpdate):
    // фоновый цикл createTicketNotifications уведомит заявителя и ответственных.
    // "update deadline" — значение из enum схемы Ticket (заложено, но до сих
    // пор нигде не присваивалось).
    ticket.notifications.lastAction = "update deadline";
    ticket.notifications.pending = true;

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "warning",
      event: "обновлён дедлайн заявки",
    });
    await logEntry.save();

    res.status(201).json({
      message: "Ticket deadline updated successfully!",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update deadline for ticket ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.reject = async (req, res, next) => {
  try {
    const authData = req.auth?.legacy ?? null;

    const ticket = await Ticket.findById(req.body._id);

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    const updatedResponsibles = ticket.responsibles.filter(
      (user) => user?._id.toString() !== authData.userId.toString(),
    );

    const updatedState =
      updatedResponsibles.length > 0 ? ticket.state : "Новая";

    //если заявка откатилась в статус Новая, то сбрасываем кем и когда она была принята
    if (updatedState === "Новая") {
      ticket.processedAt = null;
      ticket.processedBy = null;
    }

    //если заявка откатилась из статуса В работе +, то сбрасываем кем и когда она была принята
    if (updatedState === "Не в работе" || updatedState === "Новая") {
      ticket.startedAt = null;
      ticket.startedBy = null;
    }

    ticket.responsibles = updatedResponsibles;

    if (ticket.rejected) {
      ticket.rejected.push({
        by: authData.userId,
        reason: req.body.rejectDesc,
      });
    } else {
      ticket.rejected = [{ by: authData.userId, reason: req.body.rejectDesc }];
    }

    ticket.state = updatedState;
    ticket.notifications = {
      lastAction: "reject ticket",
      pending: true,
    };
    ticket.version = (ticket.version ?? 0) + 1;

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "info",
      event: `отказ от заявки по причине ${req.body.rejectDesc}`,
    });
    await logEntry.save();

    res.status(201).json({
      message: "Ticket responsibles updated successfully!",
    });
  } catch (error) {
    next(
      new AppError(`Failed to reject ticket ${req.body._id}`, 500, true, error),
    );
  }
};

exports.close = async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({});
    const authedUser = req.auth?.legacy ?? null;
    const { permissions } = authedUser;

    const ticket = await Ticket.findById(req.body._id);

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    // Обязательные пункты чек-листа держат закрытие так же, как работы:
    // проверка на клиенте прячет кнопку, но закрыть можно и минуя её
    const unchecked = (ticket.checklist ?? []).filter(
      (item) => item.mandatory && !item.checked,
    );
    if (unchecked.length > 0) {
      return next(
        new AppError(
          `В чек-листе остались невыполненные обязательные пункты`,
          422,
        ),
      );
    }

    const works = await Work.find({
      tickets: ticket._id,
    });

    let responsibles = [];

    for (let resp of ticket.responsibles) {
      const user = await User.findById(resp._id);

      const worksExecutorsIds = works
        .filter((work) => work.finishedAt)
        .map((work) => work.finishedBy._id.toString());

      // Право ЧУЖОГО человека: читать `user.permissions` напрямую нельзя —
      // с ролями флага в документе нет, и исполнитель молча выпал бы из списка.
      const respPermissions = (await effectivePermissions(user)).permissions;
      if (
        worksExecutorsIds.includes(resp._id.toString()) ||
        respPermissions.canAvoidWorks
      ) {
        responsibles.push(user);
      }
    }

    const prevState = ticket.state;

    if (works.length > 0 || req.auth.can({ ticket: ["closeWithoutWork"] })) {
      ticket.finishedAt = new Date();
      ticket.responsibles = responsibles;
      ticket.finishedBy = authedUser._id;
      ticket.isClosed = true;
      ticket.closingComment = req.body.closingComment;
      ticket.state = "Закрыта";
      ticket.notifications = {
        lastAction: "close ticket",
        pending: true,
      };
      ticket.version = (ticket.version ?? 0) + 1;
    } else {
      return next(
        new AppError(`Невозможно закрыть заявку без указания работ`, 422),
      );
    }

    // удаление активных сеансов pro32connect
    if (prevState !== ticket.state && ticket.state === "Закрыта") {
      const connection = await Connection.findOne({
        ticket: ticket.num,
      });

      if (connection) {
        if (prefs.getScreen?.isActive) {
          await fetch(
            `https://api.pro32connect.ru/v1/support/close?apikey=${resolveGetScreenApiKey(authedUser)}&connection_id=${connection.getScreenId}`,
            {
              method: "POST",
            },
          );
        }
        await Connection.deleteOne({ _id: connection._id });
      }
    }

    // добавляем комментарий
    const comment = new Comment({
      content: req.body.closingComment,
      ticketId: ticket._id,
      notifications: {
        lastAction: "new comment",
        pending: false,
      },
      createdBy: authedUser,
      updatedBy: authedUser,
    });

    await comment.save();

    ticket.comments.push(comment._id);

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authedUser.firstName,
        lastName: authedUser.lastName,
      },
      severity: "info",
      event: `заявка закрыта`,
    });
    await logEntry.save();

    res.status(201).json({
      message: "Ticket closed successfully!",
    });
  } catch (error) {
    next(
      new AppError(`Failed to close ticket ${req.body._id}`, 500, true, error),
    );
  }
};

exports.backToWork = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const authedUser = await User.findById(userId);

    // Заявку уже подняла и проверила `requireTicketAccess`
    const ticket = req.ticket;

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    ticket.finishedAt = null;
    ticket.finishedBy = null;
    ticket.isClosed = false;
    ticket.state = "В работе";
    ticket.returningComment = req.body.returningComment;
    ticket.notifications = {
      lastAction: "back to work",
      pending: true,
    };
    ticket.version = (ticket.version ?? 0) + 1;

    // добавляем комментарий
    const comment = new Comment({
      content: req.body.returningComment,
      ticketId: ticket._id,
      notifications: {
        lastAction: "new comment",
        pending: false,
      },
      createdBy: authedUser,
      updatedBy: authedUser,
    });

    await comment.save();

    ticket.comments.push(comment._id);

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authedUser.firstName,
        lastName: authedUser.lastName,
      },
      severity: "info",
      event: `заявка возвращена в работу, комментарий: ${req.body.returningComment}`,
    });
    await logEntry.save();

    res.status(201).json({
      message: "Ticket updated successfully!",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to return back to work ticket ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({});
    const authData = req.auth?.legacy ?? null;
    const authedUser = await User.findById(authData.userId);

    const ticket = await Ticket.findById(req.params.id);

    if (ticket) {
      const connection = await Connection.findOne({
        ticket: ticket.num,
      });

      if (connection) {
        if (prefs.getScreen?.isActive) {
          await fetch(
            `https://api.pro32connect.ru/v1/support/close?apikey=${resolveGetScreenApiKey(authedUser)}&connection_id=${connection.getScreenId}`,
            {
              method: "POST",
            },
          );
        }
        await Connection.deleteOne({ _id: connection._id });
      }

      if (ticket.attachments) {
        for (let file of ticket.attachments) {
          storage.deleteObject(file.name).catch((error) =>
            logger.log("error", `Failed to delete file`, error),
          );
        }
      }

      const works = await Work.find({ tickets: ticket._id });

      for (let work of works) {
        if (work.tickets.length > 1) {
          work.tickets = work.tickets.filter(
            (t) => t._id.toString() !== ticket._id.toString(),
          );
          await work.save();
        } else {
          await Work.deleteOne({ _id: work._id });
        }
      }

      await Ticket.deleteOne({ _id: req.params.id });

      res.status(201).json({
        message: "Ticket deleted successfully!",
      });
    } else {
      return next(new AppError(`Couldn't find ticket ${req.params.id}`, 404));
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete ticket ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.deleteMultiple = async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({});
    const authData = req.auth?.legacy ?? null;
    const authedUser = await User.findById(authData.userId);
    const { ids } = req.body;

    for (const id of ids) {
      const ticket = await Ticket.findById(id);

      if (ticket) {
        const connection = await Connection.findOne({
          ticket: ticket.num,
        });

        if (connection) {
          if (prefs.getScreen?.isActive) {
            await fetch(
              `https://api.pro32connect.ru/v1/support/close?apikey=${resolveGetScreenApiKey(authedUser)}&connection_id=${connection.getScreenId}`,
              {
                method: "POST",
              },
            );
          }
          await Connection.deleteOne({ _id: connection._id });
        }

        if (ticket.attachments) {
          for (let file of ticket.attachments) {
            storage.deleteObject(file.name).catch((error) =>
              logger.log("error", "Failed to delete file", error),
            );
          }
        }

        const works = await Work.find({ tickets: ticket._id });

        for (let work of works) {
          if (work.tickets.length > 1) {
            work.tickets = work.tickets.filter(
              (t) => t._id.toString() !== ticket._id.toString(),
            );
            await work.save();
          } else {
            await Work.deleteOne({ _id: work._id });
          }
        }

        await Ticket.deleteOne({ _id: id });
      }
    }

    res.status(200).json({
      message: "Tickets deleted successfully!",
    });
  } catch (error) {
    next(new AppError(`Failed to delete multiple tickets`, 500, true, error));
  }
};

// Массовое принятие в работу. Повторяет логику takeToWork по каждой заявке.
// Версию не проверяем (в списке её нет), но инкрементируем — чтобы открытые
// detail-вью ловили конфликт.
exports.takeToWorkMultiple = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { ids, takeOver } = req.body;
    const authedUserId = authedUser._id.toString();

    for (const id of ids) {
      const ticket = await Ticket.findById(id);
      if (!ticket) continue;

      ticket.state = "В работе";
      ticket.startedAt = new Date();
      ticket.startedBy = authedUser._id;
      ticket.updatedBy = authedUser._id;
      ticket.notifications = {
        lastAction: "take ticket to work",
        pending: true,
      };

      const isResponsible = ticket.responsibles.some(
        (resp) => resp._id.toString() === authedUserId,
      );

      // Как и в takeToWork: самодобавление сразу помечаем уведомлённым,
      // чтобы будущие редактирования не слали «вы назначены ответственным».
      const selfAsResponsible = {
        ...authedUser,
        isNotified: { telegram: true, email: true },
      };

      if (takeOver) {
        const self = ticket.responsibles.find(
          (resp) => resp._id.toString() === authedUserId,
        );
        ticket.responsibles = self ? [self] : [selfAsResponsible];
      } else if (!isResponsible) {
        ticket.responsibles = ticket.responsibles.concat(selfAsResponsible);
      }

      ticket.version = (ticket.version ?? 0) + 1;
      await ticket.save();

      const logEntry = new TicketLog({
        ticketId: ticket._id,
        user: {
          firstName: authedUser.firstName,
          lastName: authedUser.lastName,
        },
        severity: "info",
        event: "заявка принята в работу",
      });
      await logEntry.save();

      if (takeOver) {
        const takeOverLog = new TicketLog({
          ticketId: ticket._id,
          user: {
            firstName: authedUser.firstName,
            lastName: authedUser.lastName,
          },
          severity: "info",
          event: "взял(а) заявку на себя",
        });
        await takeOverLog.save();
      }
    }

    res.status(201).json({
      message: "Tickets taken to work successfully!",
    });
  } catch (error) {
    next(
      new AppError(
        "Failed to take multiple tickets to work",
        500,
        true,
        error,
      ),
    );
  }
};

// Массовое закрытие. Повторяет логику close по каждой заявке. Сохраняем правило
// одиночного закрытия: закрываем только заявки с указанными работами (или при
// праве canAvoidWorks); остальные пропускаем, не роняя весь батч.
exports.closeMultiple = async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({});
    const authedUser = req.auth?.legacy ?? null;
    const { permissions } = authedUser;
    const { ids, closingComment } = req.body;

    for (const id of ids) {
      const ticket = await Ticket.findById(id);
      if (!ticket) continue;

      const works = await Work.find({ tickets: ticket._id });

      if (!(works.length > 0 || req.auth.can({ ticket: ["closeWithoutWork"] }))) continue;
      // То же правило, что у одиночного закрытия: заявку с невыполненным
      // обязательным пунктом массовое действие пропускает, а не закрывает
      if (
        (ticket.checklist ?? []).some((item) => item.mandatory && !item.checked)
      )
        continue;

      let responsibles = [];
      for (let resp of ticket.responsibles) {
        const user = await User.findById(resp._id);

        const worksExecutorsIds = works
          .filter((work) => work.finishedAt)
          .map((work) => work.finishedBy._id.toString());

        // Право ЧУЖОГО человека — только через effectivePermissions.
        const respPermissions = (await effectivePermissions(user)).permissions;
        if (
          worksExecutorsIds.includes(resp._id.toString()) ||
          respPermissions.canAvoidWorks
        ) {
          responsibles.push(user);
        }
      }

      const prevState = ticket.state;

      ticket.finishedAt = new Date();
      ticket.responsibles = responsibles;
      ticket.finishedBy = authedUser._id;
      ticket.isClosed = true;
      ticket.closingComment = closingComment;
      ticket.state = "Закрыта";
      ticket.notifications = {
        lastAction: "close ticket",
        pending: true,
      };
      ticket.version = (ticket.version ?? 0) + 1;

      // удаление активных сеансов pro32connect
      if (prevState !== ticket.state && ticket.state === "Закрыта") {
        const connection = await Connection.findOne({
          ticket: ticket.num,
        });

        if (connection) {
          if (prefs.getScreen?.isActive) {
            await fetch(
              `https://api.pro32connect.ru/v1/support/close?apikey=${resolveGetScreenApiKey(authedUser)}&connection_id=${connection.getScreenId}`,
              {
                method: "POST",
              },
            );
          }
          await Connection.deleteOne({ _id: connection._id });
        }
      }

      // добавляем комментарий с результатом выполнения
      const comment = new Comment({
        content: closingComment,
        ticketId: ticket._id,
        notifications: {
          lastAction: "new comment",
          pending: false,
        },
        createdBy: authedUser,
        updatedBy: authedUser,
      });
      await comment.save();
      ticket.comments.push(comment._id);

      await ticket.save();

      const logEntry = new TicketLog({
        ticketId: ticket._id,
        user: {
          firstName: authedUser.firstName,
          lastName: authedUser.lastName,
        },
        severity: "info",
        event: `заявка закрыта`,
      });
      await logEntry.save();
    }

    res.status(201).json({
      message: "Tickets closed successfully!",
    });
  } catch (error) {
    next(new AppError(`Failed to close multiple tickets`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const authData = req.auth?.legacy ?? null;
    const authedUser = await User.findById(authData.userId);
    const prefs = await Preferences.findOne({});

    const {
      _id,
      title,
      company,
      categoryId,
      applicantId,
      description,
      responsibles,
      deadline,
      startedAt,
      finishedAt,
      isClosed,
      state,
    } = req.body;

    const ticket = await Ticket.findById(_id);

    if (!ticket) {
      return next(new AppError(`Couldn't find ticket ${_id}`, 404));
    }

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    const attachments = req.files?.map(buildAttachment);

    const customFields = req.body.customFields
      ? JSON.parse(req.body.customFields)
      : [];

    const validCustomFields = customFields.filter(
      (field) => field && field.name,
    );

    const prevState = ticket.state;

    // Изменяем список ответственных, добавляем новых
    let newRespArray = [];
    let removedReps = [];
    let hasNewResponsibles = false;
    if (responsibles) {
      for (let resp of JSON.parse(responsibles)) {
        if (
          !ticket.responsibles
            .map((resp) => resp._id.toString())
            .includes(resp._id.toString())
        ) {
          ticket.responsibles.push(resp);
          hasNewResponsibles = true;
        }
      }

      // Изменяем список ответственных, удаляем старых
      newRespArray = ticket.responsibles.filter((resp) =>
        JSON.parse(responsibles)
          .map((resp) => resp._id.toString())
          .includes(resp._id.toString()),
      );

      // adding users to removedFromRepsonsibles
      removedReps = ticket.responsibles.filter(
        (resp) =>
          !JSON.parse(responsibles)
            .map((resp) => resp._id.toString())
            .includes(resp._id.toString()),
      );
      for (let resp of removedReps) {
        ticket.removedFromResponsibles.push({
          _id: resp._id,
          lastName: resp.lastName,
          firstName: resp.firstName,
          isNotified: {
            telegram: false,
            email: false,
          },
        });
      }
    }

    ticket.title = title ? title : ticket.title;
    ticket.company = company ? JSON.parse(company) : ticket.company;
    ticket.categoryId = categoryId ? categoryId : ticket.categoryId;
    ticket.applicantId = applicantId ? applicantId : ticket.applicantId;
    ticket.description = description ? description : ticket.description;
    ticket.customFields = validCustomFields;
    ticket.attachments =
      attachments?.length > 0
        ? [...ticket.attachments, ...attachments]
        : ticket.attachments;
    ticket.responsibles = responsibles ? newRespArray : ticket.responsibles;
    ticket.deadline = deadline ? deadline : ticket.deadline;
    ticket.startedAt = startedAt ? startedAt : ticket.startedAt;
    ticket.startedBy = startedAt ? authData.userId : ticket.startedBy;
    ticket.finishedAt = finishedAt ? finishedAt : ticket.finishedAt;
    ticket.finishedBy = finishedAt ? authData.userId : ticket.finishedBy;

    // сбрасываем значение isClosed на false, если заявка не в статусе Закрыта
    if (state && state !== "Закрыта") {
      ticket.isClosed = false;
    }

    ticket.state = state ? state : ticket.state;
    ticket.isClosed = isClosed ? isClosed : ticket.isClosed;

    // Ветка "process ticket" уведомляет каждого ответственного с пустым
    // isNotified, поэтому запускаем её только когда в этом редактировании
    // реально добавлены новые ответственные. Иначе правка любого поля
    // (категории, темы и т.п.) повторно слала бы «вы назначены ответственным»
    // тем, кто когда-то добавил себя сам и флага не получил.
    if (hasNewResponsibles) {
      ticket.notifications = {
        lastAction: "process ticket",
        pending: true,
      };
    }
    ticket.updatedBy = authData.userId;
    //если заявка принята в работу делаем отметки кто и когда её принял
    if (state === "В работе") {
      ticket.startedAt = new Date();
      ticket.startedBy = authedUser;
    }
    //если заявка откатилась из статуса В работе +, то сбрасываем кем и когда она была принята
    if (state === "Не в работе" || state === "Новая") {
      ticket.startedAt = null;
      ticket.startedBy = null;
    }

    // удаление активных сеансов pro32connect
    if (prevState !== ticket.state && ticket.state === "Закрыта") {
      const connection = await Connection.findOne({
        ticket: ticket.num,
      });

      if (connection) {
        if (prefs.getScreen?.isActive) {
          await fetch(
            `https://api.pro32connect.ru/v1/support/close?apikey=${resolveGetScreenApiKey(authedUser)}&connection_id=${connection.getScreenId}`,
            {
              method: "POST",
            },
          );
        }
        await Connection.deleteOne({ _id: connection._id });
      }
    }

    ticket.version = (ticket.version ?? 0) + 1;

    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "info",
      event: `заявка обновлена`,
    });
    await logEntry.save();

    res.status(201).json({
      message: "Ticket updated successfully!",
      ticket: ticket,
    });
  } catch (error) {
    if (req.files) {
      for (let file of req.files) {
        storage.deleteObject(file.key).catch(() =>
          logger.log("error", "Failed to delete file"),
        );
      }
    }
    next(
      new AppError(`Failed to update ticket ${req.body._id}`, 500, true, error),
    );
  }
};

exports.getAllOpenedTg = async (req, res, next) => {
  const contextLogger = logger.addNoAuthContext(req);
  try {
    contextLogger.log("info", "Fetching all opened tickets from Telegram");
    /**
     * Актора разрешает `services/telegramActor` — тот же код, что и у
     * браузерного сеанса собирает `req.auth`.
     *
     * До этого здесь стояло `User.findOne(...)` без проверки результата, а
     * ниже — `req.auth.can(...)`, которого на маршруте с одним лишь
     * `isTelegramBot` не существует: ручка отвечала 500 на КАЖДЫЙ вызов с тех
     * пор, как права переехали на роли. Плюс непривязанный чат ронял
     * деструктуризацию `null`.
     */
    // На `/api/bot/*` актора уже разрешил `attachTelegramActor`; на старом
    // `/api/tg/tickets/all-opened` его нет, и он поднимается по `chat_id`.
    // Вторая ветка уходит вместе со старым маршрутом после переезда бота.
    const actor = req.auth || (await resolveTelegramActor(req.query.chat_id));
    if (!actor) {
      return next(
        new AppError(
          `Telegram не привязан к учётной записи. Привяжите его в «Мой аккаунт»`,
          401,
        ),
      );
    }

    const user = actor.user;
    const userId = user._id;

    const allTickets = await Ticket.find({ isClosed: false })
      .populate({
        path: "applicantId",
        select: "firstName lastName email phone position subdivision timezone",
        populate: { path: "subdivision", select: "name timezone parent" },
      })
      .populate({
        path: "categoryId",
        select: "title",
      })
      .populate({
        path: "comments",
        populate: {
          path: "createdBy",
          select: "lastName firstName",
        },
      })
      .sort({
        _id: -1,
      });

    let tickets = [];

    if (
      actor.can({
        ticket: { actions: ["administrate", "readAll"], connector: "OR" },
      })
    ) {
      // Пользователи с ролью администратор
      tickets = allTickets;
    } else if (actor.can({ ticket: ["readCompany"] })) {
      // Пользователи с разрешением на просмотр всех заявок Компании
      // Сравнение строками: `_id` — это ObjectId, и `===` между двумя
      // объектами всегда ложь, то есть ветка не срабатывала никогда.
      tickets = allTickets.filter(
        (ticket) =>
          String(ticket.company?._id) === String(user.company?._id),
      );
    } else {
      // Остальные пользователи
      tickets = await Ticket.find({
        $and: [
          { isClosed: false },
          {
            $or: [
              { "responsibles._id": userId },
              { createdBy: userId },
              { applicantId: userId },
            ],
          },
        ],
      })
        .populate({
          path: "applicantId",
          select:
            "firstName lastName email phone position banned subdivision timezone",
          populate: { path: "subdivision", select: "name timezone parent" },
        })
        .populate({
          path: "categoryId",
          select: "title",
        })
        .populate({
          path: "comments",
          populate: {
            path: "createdBy",
            select: "lastName firstName",
          },
        })
        .sort({
          _id: -1,
        });
    }

    let shortenedTickets = [];

    // Бот показывает контактный телефон — рядом с ним обязано стоять местное
    // время клиента. Подпись собираем здесь: своей логики зон у бота нет.
    const prefs = await Preferences.findOne({});
    const orgTimezone = resolveTimezone(prefs);
    const clientTimezoneOf = await createClientTimezoneResolver({
      preferences: prefs,
      companyIds: tickets.map((ticket) => ticket.company?._id),
    });

    for (let ticket of tickets) {
      const clientTimezone = clientTimezoneOf({
        user: ticket.applicantId,
        subdivision: ticket.applicantId?.subdivision,
        companyId: ticket.company?._id,
      });

      shortenedTickets.push({
        _id: ticket._id,
        num: ticket.num,
        company: {
          alias: ticket.company.alias,
        },
        title: ticket.title,
        description: ticket.description,
        applicant: ticket.applicantId,
        category: ticket.categoryId,
        responsibles: ticket.responsibles,
        createdAt: ticket.createdAt,
        deadline: ticket.deadline,
        finishedAt: ticket.finishedAt,
        isClosed: ticket.isClosed,
        state: ticket.state,
        latestComment: ticket.comments[ticket.comments.length - 1],
        clientTimezone,
        clientTimeLabel: formatClientTimeLabel({
          timezone: clientTimezone.timezone,
          orgTimezone,
        }),
      });
    }

    res.status(200).json({ tickets: shortenedTickets });
  } catch (error) {
    next(
      new AppError(
        `Failed to return all opened tickets to Telegram for chat ${req.query.chat_id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.updateChecklistItem = async (req, res, next) => {
  try {
    const { userId } = req.auth;

    const authedUser = await User.findById(userId);
    const ticketNum = req.params.ticketNum;
    const checklistItem = {
      _id: req.body._id,
      description: req.body.description,
      checked: req.body.checked,
      checkedBy: {
        _id: authedUser._id,
        lastName: authedUser.lastName,
        firstName: authedUser.firstName,
      },
    };

    const ticket = await Ticket.findOne({ num: ticketNum });

    if (!ticket) {
      return next(new AppError(`Couldn't find ticket ${ticketNum}`, 404));
    }

    const updatedItem = ticket.checklist.filter(
      (item) => item._id.toString() === checklistItem._id.toString(),
    );

    const isChecked =
      checklistItem.checked === true || checklistItem.checked === "true";
    updatedItem[0].checked = isChecked;
    updatedItem[0].checkedBy = isChecked ? checklistItem.checkedBy : undefined;
    updatedItem[0].checkedAt = isChecked ? new Date() : null;

    await ticket.save();

    res.status(201).json({
      message: "Чеклист обновлён",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update checklist item for ticket ${req.params.ticketNum}`,
        500,
        true,
        error,
      ),
    );
  }
};

/**
 * Состав чек-листа целиком: секция карточки правит его на месте и шлёт весь
 * список после каждого изменения.
 *
 * Отметки выполнения приходят не от клиента, а поднимаются из сохранённых
 * пунктов: правка соседней строки не должна переписывать «кто и когда
 * отметил». Пункт узнаётся по `_id`, а новый (у него временный id из браузера)
 * — по описанию, чтобы пересозданная строка не потеряла свою отметку.
 */
exports.updateChecklist = async (req, res, next) => {
  try {
    const ticketNum = req.params.ticketNum;

    const ticket = await Ticket.findOne({ num: ticketNum });

    if (!ticket) {
      return next(new AppError(`Couldn't find ticket ${ticketNum}`, 404));
    }

    const items = Array.isArray(req.body) ? req.body : req.body.checklist;

    if (!Array.isArray(items)) {
      return next(new AppError("Чек-лист должен быть списком", 400));
    }

    const wasEmpty = !(ticket.checklist?.length > 0);

    ticket.checklist = items.map((item) => {
      const saved = ticket.checklist?.find(
        (previous) =>
          previous._id?.toString() === item._id?.toString() ||
          previous.description === item.description,
      );
      return {
        ...(saved?._id ? { _id: saved._id } : {}),
        description: item.description,
        mandatory: !!item.mandatory,
        checked: saved?.checked ?? false,
        checkedBy: saved?.checked ? saved.checkedBy : undefined,
        checkedAt: saved?.checked ? saved.checkedAt : null,
      };
    });

    await ticket.save();

    // Отметка в хронике: до 31.07 состав чек-листа менялся молча — в ленте не
    // было ни следа, кто и когда его завёл. Источник важен: чек-лист, собранный
    // из руководства ИИ, — это и есть та фича, ради которой их станет больше,
    // и в истории она должна отличаться от ручной правки
    const { firstName, lastName } = req.auth.legacy;
    const fromAi = req.body?.source === "ai";
    const templateTitle = req.body?.templateTitle;

    // Смену шаблона называем вслух: часть отметок при ней исчезает, и без
    // записи это выглядит как чужая ошибка
    const event = templateTitle
      ? wasEmpty
        ? `чек-лист из шаблона «${templateTitle}»`
        : `чек-лист заменён на «${templateTitle}»`
      : fromAi
        ? `чек-лист составлен ИИ: пунктов ${ticket.checklist.length}`
        : ticket.checklist.length === 0
          ? `чек-лист убран`
          : wasEmpty
            ? `составлен чек-лист: пунктов ${ticket.checklist.length}`
            : `изменён чек-лист`;

    const log = new TicketLog({
      ticketId: ticket._id,
      kind: "checklist",
      user: { firstName, lastName },
      severity: "info",
      event,
    });
    await log.save();

    res.status(201).json({
      message: "Чеклист обновлён",
      checklist: ticket.checklist,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update checklist for ticket ${req.params.ticketNum}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.addAttachments = async (req, res, next) => {
  try {
    const { ticketNum } = req.params;
    const files = req.files;

    logger.info(`Attempting to add attachments to ticket ${ticketNum}`, {
      filesCount: files ? files.length : 0,
      filenames: files ? files.map((f) => f.originalname) : [],
      mimTypes: files ? files.map((f) => f.mimetype) : [],
    });

    if (!files || files.length === 0) {
      logger.warn(`No files provided for ticket ${ticketNum}`);
      return res.status(400).json({ error: "No files provided" });
    }

    const ticket = await Ticket.findOne({ num: ticketNum });
    if (!ticket) {
      logger.error(`Ticket ${ticketNum} not found`);
      return res.status(404).json({ error: "Ticket not found" });
    }

    // Add new attachments to existing ones
    const newAttachments = files.map((file) => {
      logger.info(`Processing file: ${file.originalname} -> ${file.key}`, {
        size: file.size,
        mimetype: file.mimetype,
      });

      return buildAttachment(file);
    });

    ticket.attachments = [...(ticket.attachments || []), ...newAttachments];
    await ticket.save();

    // Отметка в хронике: файл, принесённый уже после создания заявки, иначе
    // появляется молча — не видно ни кто, ни когда. Вложения, приехавшие
    // ВМЕСТЕ с заявкой, событием не отмечаются: они уже перечислены в описании.
    // Поля именно те, что есть в схеме TicketLog: до 31.07 здесь писались
    // action/description/createdBy, которых в ней нет, и Mongoose в
    // strict-режиме молча их выбрасывал — в базе оставалась пустая запись.
    const { firstName, lastName } = req.auth.legacy;

    const log = new TicketLog({
      ticketId: ticket._id,
      kind: "attachmentAdded",
      user: { firstName, lastName },
      severity: "info",
      event:
        newAttachments.length === 1
          ? `прикреплён файл «${newAttachments[0].originalName || newAttachments[0].name}»`
          : `прикреплено файлов: ${newAttachments.length}`,
      files: newAttachments.map((attachment) => ({
        name: attachment.name,
        originalName: attachment.originalName,
      })),
    });
    await log.save();

    logger.info(
      `Successfully added ${files.length} attachments to ticket ${ticketNum}`,
    );

    res.status(200).json({
      success: true,
      message: "Files uploaded successfully",
      attachments: newAttachments,
    });
  } catch (error) {
    logger.error(
      `Error adding attachments to ticket ${req.params.ticketNum}:`,
      error,
    );
    next(new AppError(`Failed to add attachments to ticket`, 500, true, error));
  }
};

exports.removeAttachment = async (req, res, next) => {
  try {
    const { ticketNum } = req.params;
    const { attachmentName } = req.body;

    if (!attachmentName) {
      return res.status(400).json({ error: "Attachment name is required" });
    }

    const ticket = await Ticket.findOne({ num: ticketNum });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    // Find and remove the attachment
    const attachmentIndex = ticket.attachments.findIndex(
      (attachment) => attachment.name === attachmentName,
    );

    if (attachmentIndex === -1) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    // Имя нужно для записи в хронику — снимаем до удаления из массива
    const removed = ticket.attachments[attachmentIndex];

    ticket.attachments.splice(attachmentIndex, 1);
    await ticket.save();

    // Delete the underlying file (local or S3); never fail the request over it.
    try {
      await storage.deleteObject(attachmentName);
    } catch (fileError) {
      logger.warn(`Could not delete file ${attachmentName}:`, fileError);
    }

    // Удаление тоже событие: файл исчезает из описания бесследно, и
    // восстановить его нечем
    const { firstName, lastName } = req.auth.legacy;
    const log = new TicketLog({
      ticketId: ticket._id,
      kind: "attachmentRemoved",
      user: { firstName, lastName },
      severity: "info",
      event: `удалён файл «${removed?.originalName || attachmentName}»`,
      files: [
        { name: attachmentName, originalName: removed?.originalName },
      ],
    });
    await log.save();

    res.status(200).json({
      success: true,
      message: "Attachment removed successfully",
    });
  } catch (error) {
    next(
      new AppError(`Failed to remove attachment from ticket`, 500, true, error),
    );
  }
};

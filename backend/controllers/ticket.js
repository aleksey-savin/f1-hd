const storage = require("../services/storage");

const { AppError } = require("../middleware/errorHandling");
const logger = require("../utils/logger");

const getAuthData = require("../middleware/getAuthData");
const Preferences = require("../models//preferences");

const { Ticket } = require("../models/ticket");
const { isStaleVersion, sendConflict } = require("../helpers/ticketVersion");
const User = require("../models//user");
const Company = require("../models/company");
const Category = require("../models/ticketCategory");
const TicketLog = require("../models/ticketLog");
const Work = require("../models/work");
const Comment = require("../models/comment");
const CompanyLog = require("../models/companyLog");

const Connection = require("../models/pro32Connect/connection");

const { generateTicketAiGuide } = require("../services/ticketAiGuide");
const { detectTicketCategory } = require("../services/ticketCategoryService");
const { logAiTicketEvent } = require("../services/aiTicketLog");
const {
  isAudioAttachment,
  transcribeAttachment,
} = require("../services/speechToTextService");
const { buildKnownCaller } = require("../services/callerIdentityService");

const buildAttachment = (file) => ({
  mimetype: file.mimetype,
  mimeType: file.mimetype,
  name: file.key,
  originalName: file.originalname,
  size: file.size,
});

exports.getAllOpened = async (req, res, next) => {
  try {
    const { isAdmin, permissions, userId, company } = await getAuthData(req);

    const allTickets = await Ticket.find({ isClosed: false })
      .select("-description")
      .populate({
        path: "applicantId",
        select:
          "firstName lastName email phone position role isActive subdivision",
        populate: {
          path: "subdivision",
          select: "name",
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
      isAdmin ||
      permissions.canAdministrateTickets ||
      permissions.canSeeAllTickets
    ) {
      // Пользователи с ролью администратор
      filteredTickets = allTickets;
    } else if (permissions.canSeeAllCompanyTickets) {
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

    const shortenedTickets = filteredTickets.map((ticket) => ({
      _id: ticket._id,
      num: ticket.num,
      company: ticket.company,
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

exports.getRecentlyClosed = async (req, res, next) => {
  try {
    const {
      _id: userId,
      isAdmin,
      permissions,
      company,
    } = await getAuthData(req);

    // Calculate date threshold (14 days ago)
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Build query conditions based on permissions
    let matchConditions = {
      isClosed: true,
      finishedAt: { $gte: fourteenDaysAgo },
    };

    if (
      isAdmin ||
      permissions.canAdministrateTickets ||
      permissions.canSeeAllTickets
    ) {
      // No additional filters for admins
    } else if (permissions.canSeeAllCompanyTickets) {
      matchConditions["company._id"] = company._id;
    } else {
      // Filter for specific user involvement
      matchConditions.$or = [
        { "responsibles._id": userId },
        { createdBy: userId },
        { applicantId: userId },
      ];
    }

    // Use aggregation pipeline for better performance
    const ticketData = await Ticket.aggregate([
      { $match: matchConditions },
      { $sort: { _id: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "applicantId",
          foreignField: "_id",
          as: "applicant",
          pipeline: [
            {
              $project: {
                firstName: 1,
                lastName: 1,
                email: 1,
                phone: 1,
                position: 1,
                role: 1,
                isActive: 1,
                subdivision: 1,
              },
            },
            {
              $lookup: {
                from: "subdivisions",
                localField: "subdivision",
                foreignField: "_id",
                as: "subdivision",
                pipeline: [{ $project: { name: 1 } }],
              },
            },
            {
              $addFields: {
                subdivision: { $arrayElemAt: ["$subdivision", 0] },
              },
            },
          ],
        },
      },
      {
        $lookup: {
          from: "ticketcategories",
          localField: "categoryId",
          foreignField: "_id",
          as: "category",
          pipeline: [{ $project: { title: 1 } }],
        },
      },
      {
        $lookup: {
          from: "comments",
          localField: "comments",
          foreignField: "_id",
          as: "comments",
          pipeline: [
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            {
              $lookup: {
                from: "users",
                localField: "createdBy",
                foreignField: "_id",
                as: "createdBy",
                pipeline: [{ $project: { firstName: 1, lastName: 1 } }],
              },
            },
            {
              $addFields: {
                createdBy: { $arrayElemAt: ["$createdBy", 0] },
              },
            },
            {
              $project: {
                content: 1,
                attachments: 1,
                createdAt: 1,
                createdBy: 1,
              },
            },
          ],
        },
      },
      {
        $lookup: {
          from: "works",
          let: { ticketId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ["$$ticketId", { $ifNull: ["$tickets", []] }] },
                    { $eq: ["$scheduled", true] },
                    { $eq: ["$finishedAt", null] },
                  ],
                },
              },
            },
          ],
          as: "scheduledWorks",
        },
      },
      {
        $project: {
          _id: 1,
          num: 1,
          company: 1,
          title: 1,
          attachments: 1,
          deadline: 1,
          finishedAt: 1,
          isClosed: 1,
          state: 1,
          createdAt: 1,
          routineTask: 1,
          responsibles: 1,
          applicant: { $arrayElemAt: ["$applicant", 0] },
          category: { $arrayElemAt: ["$category", 0] },
          latestComment: { $arrayElemAt: ["$comments", 0] },
          scheduledWorks: 1,
        },
      },
    ]);

    res.status(200).json({ tickets: ticketData });
  } catch (error) {
    next(
      new AppError("Failed to fetch recently closed tickets", 500, true, error),
    );
  }
};

exports.getUsersTickets = async (req, res, next) => {
  const contextLogger = await logger.addContext(req);
  try {
    const authedUser = await getAuthData(req);

    const { isAdmin, permissions, userId } = authedUser;

    let tickets = [];

    contextLogger.log("info", "Fetching user's tickets");

    if (
      isAdmin ||
      permissions.canAdministrateTickets ||
      permissions.canSeeAllTickets
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

exports.getClosed = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);
    const { isAdmin, permissions } = authedUser;

    const { companies, responsibles, categories, applicants, from, to } =
      req.body;

    const fromDate = new Date(from);
    let toDate = new Date(to);
    toDate = toDate.setDate(toDate.getDate() + 1); // Include the end date

    let query = {
      isClosed: true,
      finishedAt: { $gte: fromDate, $lte: toDate },
    };

    // Add company filter
    if (companies && companies.length > 0) {
      query["company._id"] = { $in: companies };
    } else {
      // Default to user's company if no companies selected
      query["company._id"] = authedUser.company._id;
    }

    // Add optional filters if provided
    if (responsibles && responsibles.length > 0) {
      query["responsibles._id"] = { $in: responsibles };
    }

    if (categories && categories.length > 0) {
      query["categoryId"] = { $in: categories };
    }

    if (applicants && applicants.length > 0) {
      query["applicantId"] = { $in: applicants };
    }

    // Apply permission-based restrictions
    if (!isAdmin) {
      if (permissions.canSeeAllCompanyTickets) {
      } else if (permissions.canSeeAllTickets) {
        // No additional restrictions
      } else if (permissions.canPerformTickets) {
        // Can only see tickets they're responsible for
        if (!query["responsibles._id"]) {
          query["responsibles._id"] = authedUser._id;
        }
      } else {
        // End users can only see tickets they created
        query["applicantId"] = authedUser._id;
      }
    }

    // Fetch tickets with populate for better data
    const tickets = await Ticket.find(query)
      .populate({
        path: "categoryId",
        select: "title",
      })
      .populate({
        path: "applicantId",
        select: "firstName lastName email",
      })
      .sort({ finishedAt: -1 });

    // Transform tickets to match the structure expected by the frontend
    const transformedTickets = tickets.map((ticket) => {
      return {
        _id: ticket._id,
        num: ticket.num,
        title: ticket.title,
        applicant: ticket.applicantId || ticket.applicant,
        category: ticket.categoryId || ticket.category,
        responsibles: ticket.responsibles,
        createdAt: ticket.createdAt,
        finishedAt: ticket.finishedAt,
        state: ticket.state,
        isClosed: ticket.isClosed,
      };
    });

    res.status(200).json({
      total: transformedTickets.length,
      tickets: transformedTickets,
    });
  } catch (error) {
    next(new AppError("Failed to fetch closed tickets", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const { isEndUser } = await getAuthData(req);
    const ticketNum = req.params.ticketNum;

    const ticket = await Ticket.findOne({ num: ticketNum })
      .populate({
        path: "applicantId",
        select:
          "firstName lastName email phone position role isActive subdivision activeDirectoryObjectGUID",
        populate: {
          path: "subdivision",
          select: "name email address phone linkToMap",
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

    // У заявки может не быть компании (легаси-данные): toObject() с minimize
    // вырезает пустой объект company — без ?. карточка падала бы в 500.
    const company = await Company.findById(ticket.company?._id).populate({
      path: "employees",
      select: "firstName lastName email phone position isActive",
      match: { isActive: true },
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
    const worksWithLinks = works.map((work) => ({
      ...work.toObject(),
      linkedTickets: work.tickets
        .map((t) => linkedById.get(t.toString()))
        .filter(Boolean),
    }));

    const logs = await TicketLog.find({
      $or: [{ ticket: ticketNum }, { ticketId: ticket._id }],
    });

    res.status(200).json({
      message: "Ticket fetched",
      ticket: ticket,
      company: company || {},
      works: worksWithLinks,
      logs: isEndUser ? [] : logs,
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
    const authedUser = await getAuthData(req);

    let companies = [];
    let applicants = [];
    let categories = [];
    let responsibles = [];

    if (authedUser.isEndUser) {
      companies = await Company.find({
        _id: authedUser.company._id,
      }).sort({ alias: 1 });

      responsibles = await User.find({
        $and: [{ "permissions.canPerformTickets": true }, { isActive: true }],
      }).sort({ lastName: 1 });

      if (authedUser.permissions?.canSeeAllCompanyTickets) {
        applicants = await User.find({
          "company._id": authedUser.company._id,
          isServiceAccount: false,
          isActive: true,
        });
      } else {
        applicants = [authedUser];
      }
    } else if (
      authedUser.permissions.canAdministrateTickets ||
      authedUser.isAdmin
    ) {
      companies = await Company.find({
        "responsibles._id": authedUser._id,
      }).sort({ alias: 1 });

      applicants = await User.find({
        $and: [{ isActive: true }, { isServiceAccount: false }],
      }).sort({ lastName: 1 });

      categories = await Category.find({ isActive: true }).sort({
        title: 1,
      });

      responsibles = await User.find({
        $and: [{ "permissions.canPerformTickets": true }, { isActive: true }],
      }).sort({ lastName: 1 });
    } else {
      companies = await Company.find({
        "responsibles._id": authedUser._id,
      }).sort({ alias: 1 });

      applicants = await User.find({
        "company._id": { $in: companies },
        isActive: true,
      }).sort({ lastName: 1 });

      categories = await Category.find({
        isActive: true,
        _id: { $in: authedUser.categories },
      }).sort({
        title: 1,
      });

      responsibles = await User.find({
        _id: authedUser._id,
      }).sort({ lastName: 1 });
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

      categories: categories.map((category) => ({
        _id: category._id,
        title: category.title,
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
    const { userId, company } = await getAuthData(req);
    const { categoryId, applicantId } = req.body;
    const prefs = await Preferences.findOne({});
    const userCompany = await Company.findById(company._id);
    const now = new Date();

    const applicant = applicantId ? applicantId : userId;

    const attachments = req.files?.map(buildAttachment);

    const customFields = req.body.customFields
      ? JSON.parse(req.body.customFields)
      : [];

    const validCustomFields = customFields.filter(
      (field) => field && field.name,
    );

    const ticket = new Ticket({
      title: req.body.title,
      description: req.body.description,
      template: req.body.template ? JSON.parse(req.body.template) : null,
      customFields: validCustomFields,
      attachments: attachments,
      isClosed: false,
      categoryId: categoryId,
      // Заявитель либо авторизованный пользователь, либо указанный в полной форме создания заявки
      applicantId: applicant,
      company: req.body.company ? JSON.parse(req.body.company) : userCompany,
      responsibles: JSON.parse(req.body.responsibles),
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
    next(new AppError(`Failed to add ticket`, 500, true, error));
  }
};

exports.regenerateAiGuide = async (req, res, next) => {
  try {
    const { _id } = req.body;

    const ticket = await Ticket.findById(_id).select("_id");
    if (!ticket) {
      return next(new AppError(`Ticket not found`, 404, true));
    }

    await Ticket.findByIdAndUpdate(_id, { "aiGuide.status": "pending" });

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

// Подбор категории заявки ИИ по запросу пользователя. Использует ту же логику, что
// и фоновое автоопределение (detectTicketCategory), но синхронно возвращает результат
// для обратной связи в интерфейсе: назначенную категорию либо ближайшие кандидаты.
exports.detectCategory = async (req, res, next) => {
  try {
    const { _id } = req.body;

    const ticket = await Ticket.findById(_id).select("_id");
    if (!ticket) {
      return next(new AppError(`Ticket not found`, 404, true));
    }

    const result = await detectTicketCategory(_id);

    res.status(200).json({
      message: "Category detection finished",
      result,
    });
  } catch (error) {
    next(new AppError(`Failed to detect ticket category`, 500, true, error));
  }
};

exports.toggleAiGuideItem = async (req, res, next) => {
  try {
    const { _id, index, done } = req.body;

    const ticket = await Ticket.findById(_id).select("aiGuide");
    if (!ticket || !ticket.aiGuide?.items?.[index]) {
      return next(new AppError(`AI guide item not found`, 404, true));
    }

    ticket.aiGuide.items[index].done = !!done;
    await ticket.save();

    res.status(200).json({
      message: "AI guide item updated",
      aiGuide: ticket.aiGuide,
    });
  } catch (error) {
    next(new AppError(`Failed to update AI guide item`, 500, true, error));
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
      status: "pending",
      text: ticket.attachments[attachmentIndex].speechToText?.text || "",
      error: "",
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
      ticket.attachments[attachmentIndex].speechToText = {
        status: "error",
        text: ticket.attachments[attachmentIndex].speechToText?.text || "",
        error: error.message,
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
        `Ошибка распознавания записи звонка: ${error.message}`,
        "danger",
      );

      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to recognize speech",
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

    const authData = await getAuthData(req);

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
    const authedUser = await getAuthData(req);

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
    const authData = await getAuthData(req);

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
    const authedUser = await getAuthData(req);

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
    const authData = await getAuthData(req);

    const ticket = await Ticket.findById(req.body._id);

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
    }

    ticket.deadline = req.body.deadline;
    ticket.version = (ticket.version ?? 0) + 1;

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
    const authData = await getAuthData(req);

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
    const authedUser = await getAuthData(req);
    const { permissions } = authedUser;

    const ticket = await Ticket.findById(req.body._id);

    if (isStaleVersion(ticket, req.body.expectedVersion)) {
      return sendConflict(res, ticket);
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

      if (
        worksExecutorsIds.includes(resp._id.toString()) ||
        user.permissions.canAvoidWorks
      ) {
        const user = await User.findById(resp._id);
        responsibles.push(user);
      }
    }

    const prevState = ticket.state;

    if (works.length > 0 || permissions.canAvoidWorks) {
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
            `https://api.pro32connect.ru/v1/support/close?apikey=${authedUser.getScreen.api}&connection_id=${connection.getScreenId}`,
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
    const { userId } = await getAuthData(req);
    const authedUser = await User.findById(userId);

    const ticket = await Ticket.findById(req.body._id);

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
    const authData = await getAuthData(req);
    const authedUser = await User.findById(authData.userId);

    const ticket = await Ticket.findById(req.params.id);

    if (ticket) {
      const connection = await Connection.findOne({
        ticket: ticket.num,
      });

      if (connection) {
        if (prefs.getScreen?.isActive) {
          await fetch(
            `https://api.pro32connect.ru/v1/support/close?apikey=${authedUser.getScreen.api}&connection_id=${connection.getScreenId}`,
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
    const authData = await getAuthData(req);
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
              `https://api.pro32connect.ru/v1/support/close?apikey=${authedUser.getScreen.api}&connection_id=${connection.getScreenId}`,
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
    const authedUser = await getAuthData(req);
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
    const authedUser = await getAuthData(req);
    const { permissions } = authedUser;
    const { ids, closingComment } = req.body;

    for (const id of ids) {
      const ticket = await Ticket.findById(id);
      if (!ticket) continue;

      const works = await Work.find({ tickets: ticket._id });

      if (!(works.length > 0 || permissions.canAvoidWorks)) continue;

      let responsibles = [];
      for (let resp of ticket.responsibles) {
        const user = await User.findById(resp._id);

        const worksExecutorsIds = works
          .filter((work) => work.finishedAt)
          .map((work) => work.finishedBy._id.toString());

        if (
          worksExecutorsIds.includes(resp._id.toString()) ||
          user.permissions.canAvoidWorks
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
              `https://api.pro32connect.ru/v1/support/close?apikey=${authedUser.getScreen.api}&connection_id=${connection.getScreenId}`,
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
    const authData = await getAuthData(req);
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

    /* if ((isClosed && works.length > 0) || authData.permissions.canAvoidWorks) {

    } else if (!isClosed && state !== "Закрыта") {
      ticket.state = state ? state : ticket.state;
    } else {
      return res.status(404).json({
        error: 422,
        message: "Can not close ticket without works",
      });
      } */

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
            `https://api.pro32connect.ru/v1/support/close?apikey=${authedUser.getScreen.api}&connection_id=${connection.getScreenId}`,
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
    const chatId = req.query.chat_id;
    if (!chatId) {
      return next(
        new AppError(`Для обработки запроса требуется корректный chatId`, 401),
      );
    }
    const user = await User.findOne({ "telegramBot.chatId": chatId });

    const { _id: userId, isAdmin, permissions } = user;

    Date.prototype.minusDays = function (days) {
      let date = new Date(this.valueOf());
      date.setDate(date.getDate() - days);
      return date;
    };

    const allTickets = await Ticket.find({ isClosed: false })
      .populate({
        path: "applicantId",
        select: "firstName lastName email phone position",
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
      isAdmin ||
      permissions.canAdministrateTickets ||
      permissions.canSeeAllTickets
    ) {
      // Пользователи с ролью администратор
      tickets = allTickets;
    } else if (permissions.canSeeAllCompanyTickets) {
      // Пользователи с разрешением на просмотр всех заявок Компании
      tickets = allTickets.filter(
        (ticket) => ticket.company._id === user.company._id,
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
          select: "firstName lastName email phone position isActive",
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

    for (let ticket of tickets) {
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
    const { userId } = await getAuthData(req);

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

    updatedItem[0].checked = checklistItem.checked;
    updatedItem[0].checkedBy = checklistItem.checkedBy;

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

exports.updateChecklist = async (req, res, next) => {
  try {
    const ticketNum = req.params.ticketNum;

    const ticket = await Ticket.findOne({ num: ticketNum });

    if (!ticket) {
      return next(new AppError(`Couldn't find ticket ${ticketNum}`, 404));
    }

    const checklist = req.body.map((item) => {
      const jsonItem = JSON.parse(item);
      return {
        description: jsonItem.description,
        checked: jsonItem.checked,
        mandatory: jsonItem.mandatory,
        checkedBy: jsonItem.checkedBy,
      };
    });

    ticket.checklist = checklist;

    await ticket.save();

    res.status(201).json({
      message: "Чеклист обновлён",
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

    // Log the action
    const { userId } = await getAuthData(req);
    const user = await User.findById(userId);

    const log = new TicketLog({
      ticketId: ticket._id,
      action: "Добавлены файлы",
      description: `Добавлено файлов: ${files.length}`,
      createdBy: userId,
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

    // Remove from database
    ticket.attachments.splice(attachmentIndex, 1);
    await ticket.save();

    // Delete the underlying file (local or S3); never fail the request over it.
    try {
      await storage.deleteObject(attachmentName);
    } catch (fileError) {
      logger.warn(`Could not delete file ${attachmentName}:`, fileError);
    }

    // Log the action
    const { userId } = await getAuthData(req);
    const log = new TicketLog({
      ticketId: ticket._id,
      action: "Удален файл",
      description: `Удален файл: ${attachmentName}`,
      createdBy: userId,
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

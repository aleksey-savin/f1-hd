const { Types } = require("mongoose");

const Work = require("../models/work");
const User = require("../models/user");
const { Ticket } = require("../models/ticket");
const TicketLog = require("../models//ticketLog");
const Company = require("../models/company");
const ServicePlanReport = require("../models/finances/servicePlanReport");
const TicketCategory = require("../models/ticketCategory");

const { AppError } = require("../middleware/errorHandling");
const { previewWork } = require("../services/workPreview");
const { assertTicketsAccessible } = require("../services/ticketAccess");
const { ticketTier, ticketListFilter } = require("@/services/ticketScope");

/** Суммы и условия тарифа — своё право, а не сочетание двух (спека 2026-09-11). */
const canSeeMoney = (req) => req.auth.can({ work: ["readCost"] });

/**
 * Можно ли править эту работу. Своими считаем троих, а не одного автора:
 * запланированную работу заводит один человек, а подтверждает фактом другой —
 * исполнитель, — и правило «только автор» разорвало бы этот обычный ход.
 *
 * Чужую работу правит тот, у кого есть на это право. Ограничение по заявкам
 * отдельное и стоит раньше: без него номер чужой работы открывал бы её вовсе.
 */
const canEditWork = (work, { userId, can }) =>
  can({ work: ["manage"] }) ||
  [work.createdBy?._id, work.executor?._id, work.finishedBy?._id]
    .filter(Boolean)
    .some((id) => id.toString() === userId);

/**
 * Работа не тарифицируется, если ХОТЬ ОДНА её заявка льготной категории.
 * По всем заявкам, а не по первой: одна работа вешается сразу на несколько
 * заявок (массовое добавление, «Связанные заявки»), и категории у них разные.
 * То же правило — в `workOvertime.isExcludedFromOvertime`.
 */
const isAlwaysWithinPlan = async (ticketIds) => {
  const tickets = await Ticket.find({ _id: { $in: ticketIds.filter(Boolean) } })
    .select("categoryId")
    .lean();

  const categoryIds = tickets
    .map((ticket) => ticket.categoryId)
    .filter(Boolean);

  if (categoryIds.length === 0) {
    return false;
  }

  const exempt = await TicketCategory.countDocuments({
    _id: { $in: categoryIds },
    alwaysWithinPlan: true,
  });

  return exempt > 0;
};

exports.getTicketWorks = async (req, res, next) => {
  try {
    // Заявку уже подняла и проверила `allowedToViewTicket`
    const ticket = req.ticket;

    const works = await Work.find({ tickets: ticket._id }).sort({
      _id: 1,
    });

    res.status(200).json(works);
  } catch (error) {
    next(new AppError(`Failed to fetch works`, 500, true, error));
  }
};

// replace filter method with appropriate model after update to 1.5.2 or higher
exports.getAllScheduled = async (req, res, next) => {
  try {
    const scheduledWorks = await Work.find({
      scheduled: true,
      finishedAt: null,
    }).sort({
      _id: 1,
    });

    // filter works depending on user role & permissions
    let filteredWorks = scheduledWorks;
    if (ticketTier(req.auth) !== "all") {
      const ticketIds = [...new Set(scheduledWorks.flatMap((work) => work.tickets.map(String)))];
      const visible = new Set(
        (
          await Ticket.find({ _id: { $in: ticketIds }, ...ticketListFilter(req.auth) })
            .select("_id")
            .lean()
        ).map((ticket) => String(ticket._id)),
      );
      filteredWorks = scheduledWorks.filter((work) => work.tickets.some((id) => visible.has(String(id))));
    }

    let structuredWorks = [];

    for (let work of filteredWorks) {
      const company = await Company.findById(work.company);

      let tickets = [];
      for (let ticketId of work.tickets) {
        const ticket = await Ticket.findById(ticketId);
        tickets.push({ _id: ticketId, num: ticket.num, title: ticket.title });
      }

      structuredWorks.push({
        description: work.description,
        visitRequired: work.visitRequired,
        startedAt: work.startedAt,
        finishedAt: work.finishedAt,
        finishedBy: work.finishedBy,
        scheduled: work.scheduled,
        planningToStart: work.planningToStart,
        planningToFinish: work.planningToFinish,
        executor: work.executor,
        tickets: tickets,
        company: {
          _id: company._id,
          alias: company.alias,
        },
      });
    }

    res.status(200).json(structuredWorks);
  } catch (error) {
    next(new AppError(`Failed to fetch scheduled works`, 500, true, error));
  }
};

/**
 * Данные, которые форме работ нужны СРАЗУ при открытии: с какой даты вообще
 * можно указывать работы. Всё остальное — график, переработка, доплата —
 * приходит расчётом (`POST /works/preview`), потому что зависит от введённого
 * времени и считается тем же кодом, что выставляет счёт.
 */
exports.getAdditionalData = async (req, res, next) => {
  try {
    // Заявку уже подняла и проверила `allowedToViewTicket`
    const ticket = req.ticket;

    let limitWorksDateFrom = null;

    // Период, закрытый сформированным отчётом, трогать нельзя. Услуги берём со
    // стороны компании (как весь биллинг), а не обратным поиском по
    // ServicePlan.companies: это две несогласованные связи, и вторая устаревает
    if (ticket.isArchived) {
      const company = await Company.findById(ticket.company._id)
        .select("servicePlans")
        .lean();
      const planIds = (company?.servicePlans || []).map(
        (attachment) => attachment._id,
      );

      if (planIds.length > 0) {
        const reports = await ServicePlanReport.find({
          servicePlan: { $in: planIds },
        })
          .select("periodTo")
          .lean();

        limitWorksDateFrom = reports.reduce(
          (latest, report) =>
            report.periodTo && (!latest || report.periodTo > latest)
              ? new Date(report.periodTo.getTime() + 24 * 60 * 60 * 1000)
              : latest,
          null,
        );
      }
    }

    res.status(200).json({ limitWorksDateFrom });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch additional information for works`,
        500,
        true,
        error,
      ),
    );
  }
};

/**
 * Предварительный расчёт по заполняемой работе: переработка, причина и доплата.
 * Тело — черновик работы, ничего не сохраняется.
 */
exports.preview = async (req, res, next) => {
  try {
    const authData = req.auth?.legacy ?? null;
    const { tickets, startedAt, finishedAt } = req.body;

    const result = await previewWork({
      ticketIds: tickets,
      startedAt,
      finishedAt,
      canSeeMoney: canSeeMoney(req),
    });

    res.status(200).json(result);
  } catch (error) {
    next(new AppError(`Failed to preview work`, 500, true, error));
  }
};

exports.add = async (req, res, next) => {
  try {
    const {
      tickets,
      description,
      visitRequired,
      withinPlan,
      startedAt,
      finishedAt,
    } = req.body;

    const authData = req.auth?.legacy ?? null;
    const authedUser = await User.findById(authData.userId);

    const ticket = await Ticket.findById(tickets[0]);
    const finishedBy = await User.findById(req.body.finishedBy);
    const alwaysWithinPlan = await isAlwaysWithinPlan(tickets);

    const work = new Work({
      startedAt: startedAt,
      finishedAt: finishedAt,
      finishedBy: finishedBy ? finishedBy : authedUser,
      description: description,
      visitRequired: visitRequired,
      withinPlan: alwaysWithinPlan ? true : withinPlan,
      tickets: tickets.filter(Boolean),
      company: ticket.company._id,
      finances: {
        status: "preview",
      },
      createdBy: {
        _id: authData.userId,
        firstName: authData.firstName,
        lastName: authData.lastName,
        profileImagePath: authData.profileImagePath,
      },
      updatedBy: {
        _id: authData.userId,
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
    });

    await work.save();

    // добавляем запись в лог по каждой привязанной заявке: одна работа может
    // быть привязана сразу к нескольким заявкам (linkToTickets в одиночной форме
    // или массовое добавление работ из списка) — отметка нужна у всех.
    for (const linkedTicketId of tickets.filter(Boolean)) {
      const logEntry = new TicketLog({
        ticketId: linkedTicketId,
        user: {
          firstName: authData.firstName,
          lastName: authData.lastName,
        },
        severity: "info",
        event: `добавлены работы`,
      });
      await logEntry.save();
    }

    res.status(201).json({
      message: "Work added successfully!",
      work: work,
    });
  } catch (error) {
    next(new AppError(`Failed to add work`, 500, true, error));
  }
};

exports.schedule = async (req, res, next) => {
  try {
    const {
      tickets,
      description,
      visitRequired,
      withinPlan,
      planningToStart,
      planningToFinish,
    } = req.body;

    const authData = req.auth?.legacy ?? null;
    const authedUser = await User.findById(authData.userId);

    const ticket = await Ticket.findById(tickets[0]);
    const executor = await User.findById(req.body.executor);
    const alwaysWithinPlan = await isAlwaysWithinPlan(tickets);

    const work = new Work({
      scheduled: true,
      planningToStart: planningToStart,
      planningToFinish: planningToFinish,
      executor: executor ? executor : authedUser,
      description: description,
      visitRequired: visitRequired,
      withinPlan: alwaysWithinPlan ? true : withinPlan,
      tickets: tickets.filter(Boolean),
      company: ticket.company._id,
      notifications: {
        lastAction: "new scheduled work",
        pending: true,
      },
      createdBy: {
        _id: authData.userId,
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      updatedBy: {
        _id: authData.userId,
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
    });

    await work.save();

    // Запись в лог по каждой привязанной заявке: работа может относиться сразу
    // к нескольким, и отметка нужна у всех (как в `add`)
    for (const linkedTicketId of tickets.filter(Boolean)) {
      const logEntry = new TicketLog({
        ticketId: linkedTicketId,
        user: {
          firstName: authData.firstName,
          lastName: authData.lastName,
        },
        severity: "info",
        event: `запланированы работы`,
      });
      await logEntry.save();
    }

    res.status(201).json({
      message: "Work scheduled successfully!",
      work: work,
    });
  } catch (error) {
    next(new AppError(`Failed to schedule work`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { userId, firstName, lastName } = req.auth.legacy;

    const authedUser = await User.findById(userId);

    const work = await Work.findById(req.params.workId);

    if (!work) {
      return next(new AppError(`Work not found`, 404));
    }

    // Проверяем И заявки, на которых работа висит сейчас, И те, на которые её
    // переносят: иначе чужую работу можно было бы перевесить на свою заявку,
    // а свою — на чужую, и в обоих случаях запись ушла бы не в ту компанию.
    await assertTicketsAccessible(req.auth, [
      ...work.tickets,
      ...(req.body.tickets || []),
    ]);

    if (!canEditWork(work, req.auth)) {
      return next(
        new AppError(
          `Изменить можно только свою работу — заведённую вами, вашу запланированную или отмеченную вами по факту`,
          403,
        ),
      );
    }

    const finishedBy = await User.findById(req.body.finishedBy);
    const executor = await User.findById(req.body.executor);
    let notifications = work.notifications;

    // Дефолты берутся из САМОЙ работы, а не из нулей: тело обновления бывает
    // частичным (подтверждение запланированной работы шлёт только факт), и
    // `= null` стирал бы отметки, которых в этом теле просто не было.
    const {
      tickets = work.tickets,
      description = work.description,
      visitRequired = work.visitRequired,
      withinPlan = work.withinPlan,
      planningToStart = work.planningToStart,
      planningToFinish = work.planningToFinish,
      startedAt = work.startedAt,
      finishedAt = work.finishedAt,
    } = req.body;

    const ticket = await Ticket.findById(tickets[0]);
    const alwaysWithinPlan = await isAlwaysWithinPlan(tickets);

    if (
      req.body.planningToStart ||
      req.body.planningToFinish ||
      req.body.visitRequired
    ) {
      notifications = {
        lastAction: "scheduled work updated",
        pending: true,
      };
    }

    work.description = description;
    work.visitRequired = visitRequired;
    work.withinPlan = alwaysWithinPlan ? true : withinPlan;
    work.company = ticket.company._id;
    work.tickets = tickets.filter(Boolean);
    work.startedAt = startedAt;
    work.finishedAt = finishedAt;
    work.planningToStart = planningToStart;
    work.planningToFinish = planningToFinish;
    work.executor = executor || work.executor;

    // Исполнителя факта проставляем только у работы с отметками: пустое поле
    // в теле означало «не менять», а не «это сделал тот, кто нажал сохранить»
    if (finishedBy) {
      work.finishedBy = finishedBy;
    } else if (work.finishedAt && !work.finishedBy?._id) {
      work.finishedBy = authedUser;
    }

    work.notifications = notifications;
    work.updatedBy = authedUser;

    await work.save();

    for (const linkedTicketId of work.tickets) {
      const logEntry = new TicketLog({
        ticketId: linkedTicketId,
        user: {
          firstName: firstName,
          lastName: lastName,
        },
        severity: "info",
        event: `изменены работы`,
      });
      await logEntry.save();
    }

    res.status(201).json({
      message: "Work updated successfully!",
      work: work,
    });
  } catch (error) {
    // См. `delete`: отказ доступа приходит сюда готовым AppError, и 500 из него
    // делать нельзя.
    if (error instanceof AppError) return next(error);
    next(new AppError(`Failed to update work`, 500, true, error));
  }
};

exports.delete = async (req, res, next) => {
  try {
    const { userId, can } = req.auth;

    const work = await Work.findById(req.body._id);

    if (!work) {
      return next(new AppError(`Work not found`, 404));
    }

    // Право на чужие работы не заменяет доступ к заявке: иначе работу с чужой
    // заявки можно было бы стереть по одному её идентификатору. У легаси-работы
    // заявок не бывает вовсе — проверять нечего, и требовать их (assert отвечает
    // «Не указана заявка») означало бы запретить её удаление навсегда.
    if (work.tickets?.length) {
      await assertTicketsAccessible(req.auth, work.tickets);
    }

    // Удаление строже правки: только автор либо тот, кому доверены чужие работы.
    // `createdBy` бывает пустым у старых работ — сравнение через опциональную
    // цепочку, иначе вместо 403 получался бы 500.
    if (
      !can({ work: ["manage"] }) &&
      work.createdBy?._id?.toString() !== userId
    ) {
      return next(
        new AppError(
          `Work can only be deleted by the creator or an administrator`,
          403,
        ),
      );
    }

    await Work.deleteOne({ _id: work._id.toString() });
    res.status(201).json({
      success: true,
      message: "Work deleted successfully!",
    });
  } catch (error) {
    // Отказ в доступе к заявке — уже готовый AppError 403/404; обёртка в 500
    // превращала бы его в «сбой сервера» и в запись в журнале ошибок.
    if (error instanceof AppError) return next(error);
    next(new AppError(`Failed to delete work`, 500, true, error));
  }
};

// ── Архив работ: серверная выборка ──────────────────────────────────────────
// Сегмент «Работы» страницы «Архив» — зеркало ticket.getClosed: поиск, фасеты,
// сортировку и постраничность считает БД; суммарная длительность — агрегатом по
// ВСЕЙ выборке (ИТОГО легаси-отчёта, но не по странице). Id кастуются в
// ObjectId при парсинге: query переиспользуется в find/count/aggregate, а
// $match внутри aggregate строки не кастит.

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OBJECT_ID_RX = /^[0-9a-fA-F]{24}$/;
const parseObjectIdList = (value) =>
  String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => OBJECT_ID_RX.test(id))
    .map((id) => new Types.ObjectId(id));

const FINISHED_PAGE_LIMIT_DEFAULT = 50;
const FINISHED_PAGE_LIMIT_MAX = 100;
const FINISHED_SORT = {
  finished_desc: { finishedAt: -1, _id: -1 },
  finished_asc: { finishedAt: 1, _id: 1 },
};

exports.getFinished = async (req, res, next) => {
  try {
    const { isEndUser, company } = req.auth.legacy;
    const q = req.query;

    // Только завершённые: у подтверждённой запланированной работы флаг
    // scheduled не сбрасывается (work.update), надёжен только факт finishedAt
    const query = { finishedAt: { $ne: null } };
    const and = [];

    // Период по дате завершения: границы необязательны; конец — эксклюзивно
    // следующим днём, чтобы включить весь день `to`
    const fromDate = q.from ? new Date(q.from) : null;
    if (fromDate && !isNaN(fromDate)) query.finishedAt.$gte = fromDate;
    const toDate = q.to ? new Date(q.to) : null;
    if (toDate && !isNaN(toDate)) {
      toDate.setDate(toDate.getDate() + 1);
      query.finishedAt.$lt = toDate;
    }

    const companies = parseObjectIdList(q.companies);
    if (companies.length) query.company = { $in: companies };
    const executors = parseObjectIdList(q.executors);
    if (executors.length) query["finishedBy._id"] = { $in: executors };

    // Категория — свойство заявки: работа проходит фильтр, если связана хотя
    // бы с одной заявкой выбранных категорий. Предзапрос вместо $lookup — один
    // query обслуживает все три запроса ниже
    const categories = parseObjectIdList(q.categories);
    if (categories.length) {
      const categoryTickets = await Ticket.find({
        categoryId: { $in: categories },
      })
        .select("_id")
        .lean();
      and.push({ tickets: { $in: categoryTickets.map((t) => t._id) } });
    }

    // Скоуп прав: canReadWorks — глобальное право, но конечный
    // пользователь заперт в своей компании поверх любых фасетов (легаси
    // ограничивал только список опций формы — дыра закрыта)
    if (isEndUser) query.company = company._id;

    // Поиск: AND по термам (до 6, терм ≤ 64 символов) — описание работы, ФИО
    // исполнителя; целиком цифровой терм — точный номер связанной заявки
    const searchTerms = String(q.search || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    for (const term of searchTerms) {
      const rx = new RegExp(escapeRegex(term.slice(0, 64)), "i");
      const or = [
        { description: rx },
        { "finishedBy.lastName": rx },
        { "finishedBy.firstName": rx },
      ];
      if (/^\d+$/.test(term)) {
        const ticket = await Ticket.findOne({ num: Number(term) })
          .select("_id")
          .lean();
        if (ticket) or.push({ tickets: ticket._id });
      }
      and.push({ $or: or });
    }

    if (and.length) query.$and = and;

    const limit = Math.min(
      Math.max(Number(q.limit) || FINISHED_PAGE_LIMIT_DEFAULT, 1),
      FINISHED_PAGE_LIMIT_MAX,
    );
    const page = Math.max(Number(q.page) || 1, 1);
    const sort = FINISHED_SORT[q.sort] || FINISHED_SORT.finished_desc;

    const [works, total, durationAgg] = await Promise.all([
      Work.find(query)
        .select(
          "description startedAt finishedAt visitRequired finishedBy company tickets",
        )
        .populate({ path: "company", select: "alias" })
        .populate({
          path: "tickets",
          select: "num title applicantId applicant categoryId",
          populate: [
            { path: "applicantId", select: "firstName lastName" },
            { path: "categoryId", select: "title" },
          ],
        })
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Work.countDocuments(query),
      Work.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                // Отрицательная длительность — битые данные (startedAt позже
                // finishedAt): в сумму идёт нулём, а не вычитается
                $max: [
                  0,
                  {
                    $subtract: [
                      "$finishedAt",
                      { $ifNull: ["$startedAt", "$finishedAt"] },
                    ],
                  },
                ],
              },
            },
          },
        },
      ]),
    ]);

    const transformedWorks = works.map((work) => ({
      _id: work._id,
      description: work.description,
      visitRequired: Boolean(work.visitRequired),
      startedAt: work.startedAt,
      finishedAt: work.finishedAt,
      company: work.company,
      finishedBy: work.finishedBy?._id
        ? {
            _id: work.finishedBy._id,
            firstName: work.finishedBy.firstName,
            lastName: work.finishedBy.lastName,
          }
        : null,
      tickets: (work.tickets || []).map((ticket) => ({
        _id: ticket._id,
        num: ticket.num,
        title: ticket.title,
        // у старых заявок embedded applicant пуст, надёжен ref applicantId
        applicant: ticket.applicantId || ticket.applicant || null,
        category: ticket.categoryId || null,
      })),
    }));

    res.status(200).json({
      works: transformedWorks,
      total,
      page,
      limit,
      totalDurationMs: durationAgg[0]?.total || 0,
    });
  } catch (error) {
    next(new AppError("Failed to fetch finished works", 500, true, error));
  }
};

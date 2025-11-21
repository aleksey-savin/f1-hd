const Work = require("../models/work");
const User = require("../models/user");
const { Ticket } = require("../models/ticket");
const TicketLog = require("../models//ticketLog");
const Company = require("../models/company");
const ServicePlan = require("../models/finances/servicePlan");
const ServicePlanReport = require("../models/finances/servicePlanReport");
const TicketCategory = require("../models/ticketCategory");

const getAuthData = require("../middleware/getAuthData");
const { AppError } = require("../middleware/errorHandling");

exports.getTicketWorks = async (req, res, next) => {
  try {
    const ticket = await Ticket.findOne({ num: req.params.ticketNum });

    if (!ticket) {
      return next(new AppError(`Ticket not found`, 404));
    }
    const works = await Work.find({ tickets: [ticket._id] }).sort({
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
    const { isAdmin, userId, permissions, company } = await getAuthData(req);

    let filteredWorks = [];

    if (isAdmin || permissions.canSeeAllTickets) {
      filteredWorks = scheduledWorks;
    } else if (permissions.canSeeAllCompanyTickets) {
      filteredWorks = scheduledWorks.filter(
        (work) => work.company.toString() === company._id.toString(),
      );
    } else {
      for (let work of scheduledWorks) {
        for (let id of work.tickets) {
          const ticket = await Ticket.findById(id);
          if (
            userId === ticket?.applicant._id.toString() ||
            ticket?.responsibles
              .map((resp) => resp._id.toString())
              .includes(userId)
          ) {
            filteredWorks.push(work);
          }
        }
      }
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

exports.getAdditionalData = async (req, res, next) => {
  try {
    const { permissions } = await getAuthData(req);
    const { canUseFinancesModule, canSeeGlobalFinancialReport } = permissions;

    const ticket = await Ticket.findOne({ num: +req.params.ticketNum });

    const plan = await ServicePlan.findOne({
      companies: { $elemMatch: { _id: ticket.company._id } },
      ticketCategories: { $elemMatch: { _id: ticket.categoryId } },
    });

    let reports;

    if (plan) {
      reports = await ServicePlanReport.find({ servicePlan: plan._id });
    }

    let latestPeriodTo;

    if (reports && reports.length && ticket.isArchived) {
      latestPeriodTo = reports.reduce((latest, report) => {
        return !latest || report.periodTo > latest
          ? new Date(report.periodTo.getTime() + 24 * 60 * 60 * 1000)
          : latest;
      }, null);
    }

    const company = await Company.findById(ticket.company._id);

    let schedule = {};
    let companySchedule = {};
    let pricePerHourNonWorking = 0;
    let tariffingPeriod = 0;

    if (plan) {
      companySchedule = company.workSchedule || {};

      schedule = plan.companyWorkSchedule
        ? companySchedule
        : plan.customProvisionSchedule;

      if (canUseFinancesModule && canSeeGlobalFinancialReport) {
        pricePerHourNonWorking = plan.pricePerHourNonWorking;
        tariffingPeriod = plan.tariffingPeriod;
      }
    }

    const category = await TicketCategory.findById(ticket.categoryId);

    res.status(200).json({
      limitWorksDateFrom: latestPeriodTo,
      hasServicePlan: !!plan,
      schedule: schedule,
      pricePerHourNonWorking: pricePerHourNonWorking,
      tariffingPeriod: tariffingPeriod,
      alwaysWithinPlan: category?.alwaysWithinPlan || false,
    });
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

    const authData = await getAuthData(req);
    const authedUser = await User.findById(authData.userId);

    const ticket = await Ticket.findById(tickets[0]);
    const category = await TicketCategory.findById(ticket.categoryId);
    const finishedBy = await User.findById(req.body.finishedBy);

    const work = new Work({
      startedAt: startedAt,
      finishedAt: finishedAt,
      finishedBy: finishedBy ? finishedBy : authedUser,
      description: description,
      visitRequired: visitRequired,
      withinPlan: category?.alwaysWithinPlan ? true : withinPlan,
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

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: req.body.ticketId,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "info",
      event: `добавлены работы`,
    });
    await logEntry.save();

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

    const authData = await getAuthData(req);
    const authedUser = await User.findById(authData.userId);

    const ticket = await Ticket.findById(tickets[0]);
    const category = await TicketCategory.findById(ticket.categoryId);
    const executor = await User.findById(req.body.executor);

    const work = new Work({
      scheduled: true,
      planningToStart: planningToStart,
      planningToFinish: planningToFinish,
      executor: executor ? executor : authedUser,
      description: description,
      visitRequired: visitRequired,
      withinPlan: category?.alwaysWithinPlan ? true : withinPlan,
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

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: req.body.ticketId,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "info",
      event: `запланированы работы`,
    });
    await logEntry.save();

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
    const { userId, firstName, lastName } = await getAuthData(req);

    const authedUser = await User.findById(userId);

    const work = await Work.findById(req.params.workId);
    const finishedBy = await User.findById(req.body.finishedBy);
    const executor = await User.findById(req.body.executor);
    let notifications = work.notifications;

    const {
      tickets = work.tickets,
      description = work.description,
      visitRequired = false,
      withinPlan = false,
      planningToStart = null,
      planningToFinish = null,
      startedAt = null,
      finishedAt = null,
    } = req.body;

    const ticket = await Ticket.findById(tickets[0]);
    const category = await TicketCategory.findById(ticket.categoryId);

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
    work.withinPlan = category?.alwaysWithinPlan ? true : withinPlan;
    work.company = ticket.company._id;
    work.tickets = tickets.filter(Boolean);
    work.startedAt = startedAt;
    work.finishedAt = finishedAt;
    work.finishedBy = finishedBy ? finishedBy : authedUser;
    work.planningToStart = planningToStart;
    work.planningToFinish = planningToFinish;
    work.executor = executor || work.executor;
    work.notifications = notifications;
    work.updatedBy = authedUser;

    await work.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: req.body.ticketId,
      user: {
        firstName: firstName,
        lastName: lastName,
      },
      severity: "info",
      event: `изменены работы`,
    });
    await logEntry.save();

    res.status(201).json({
      message: "Work updated successfully!",
      work: work,
    });
  } catch (error) {
    next(new AppError(`Failed to update work`, 500, true, error));
  }
};

exports.delete = async (req, res, next) => {
  try {
    const { isAdmin, userId } = await getAuthData(req);

    const work = await Work.findById(req.body._id);

    if (!work) {
      return next(new AppError(`Work not found`, 404));
    }

    if (!isAdmin && work.createdBy._id.toString() !== userId) {
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
    next(new AppError(`Failed to delete work`, 500, true, error));
  }
};

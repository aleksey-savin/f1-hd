const Company = require("../../models/company");
const { Ticket } = require("../../models/ticket");
const Work = require("../../models/work");
const User = require("../../models/user");
const ServicePlan = require("../../models/finances/servicePlan");
const ServicePlanReport = require("../../models/finances/servicePlanReport");

const { AppError } = require("../../middleware/errorHandling");

const getAuthData = require("../../middleware/getAuthData");

exports.getAllActive = async (req, res, next) => {
  try {
    const reports = await ServicePlanReport.find({
      status: { $ne: "archived" },
    });

    let extendedReports = [];

    for (let report of reports) {
      let extendedReportWorks = [];
      for (let workId of report.works) {
        const work = await Work.findById(workId);
        if (!work) {
          console.warn(`Work with ID ${workId} not found, skipping...`);
          continue;
        }
        let extendedWork = { ...work.toObject(), tickets: [] };
        for (let ticketId of work.tickets) {
          const ticket = await Ticket.findById(ticketId)
            .select("-htmlDescription -attachments")
            .populate("applicantId");
          if (ticket) {
            extendedWork.tickets.push(ticket);
          }
        }

        extendedReportWorks.push(extendedWork);
      }
      const company = await Company.findById(report.company);
      const servicePlan = await ServicePlan.findById(report.servicePlan);
      const createdBy = await User.findById(report.createdBy).select(
        "_id firstName lastName",
      );
      const updatedBy = await User.findById(report.updatedBy).select(
        "_id firstName lastName",
      );

      // Skip this report if required data is missing
      if (!company || !servicePlan) {
        console.warn(
          `Missing required data for report ${report._id}: company=${!!company}, servicePlan=${!!servicePlan}`,
        );
        continue;
      }
      const extendedReport = {
        company: company,
        price: report.price,
        additionalPrice: report.additionalPrice,
        periodFrom: report.periodFrom,
        periodTo: report.periodTo,
        servicePlan: servicePlan,
        invoice: report.invoice,
        status: report.status,
        createdAt: report.createdAt,
        createdBy: createdBy || null,
        updatedAt: report.updatedAt,
        updatedBy: updatedBy || null,
        works: extendedReportWorks,
        _id: report._id,
      };
      extendedReports.push(extendedReport);
    }

    res.status(200).json(extendedReports);
  } catch (error) {
    next(new AppError("Failed to fetch all active reports", 500, true, error));
  }
};

exports.summaryReportPreview = async (req, res) => {
  try {
    // 1. First, get companies with service plans
    const companies = await Company.find({
      servicePlans: { $not: { $size: 0 } },
    }).lean();

    // 2. Get all service plan IDs in one go
    const servicePlanIds = companies.flatMap((company) =>
      company.servicePlans.map((plan) => plan._id),
    );

    // 3. Get all service plans in one query
    const servicePlans = await ServicePlan.find({
      _id: { $in: servicePlanIds },
    }).lean();

    // 4. Create a map for faster lookups
    const servicePlanMap = new Map(
      servicePlans.map((plan) => [plan._id.toString(), plan]),
    );

    const result = await Promise.all(
      companies.map(async (company) => {
        // 5. Calculate earliest active date once
        const earliestActiveSince = company.servicePlans.reduce(
          (earliest, plan) =>
            plan.isActiveSince < earliest ? plan.isActiveSince : earliest,
          new Date(),
        );

        // 6. Get tickets with necessary fields only
        const tickets = await Ticket.find({
          "company._id": company._id,
          createdAt: { $gte: earliestActiveSince },
        })
          .select("num company applicantId categoryId description responsibles")
          .lean();

        // 7. Get works with populated data in one query
        const works = await Work.find({
          tickets: { $in: tickets.map((ticket) => ticket._id) },
          $or: [
            { "finances.status": { $exists: false } },
            { "finances.status": "preview" },
          ],
        })
          .populate({
            path: "tickets",
            select: "num categoryId applicantId",
            populate: [
              { path: "categoryId", select: "title alwaysWithinPlan" },
              { path: "applicantId", select: "lastName firstName" },
            ],
          })
          .lean();

        // 8. Process works data more efficiently
        const worksData = works.map((work) => ({
          _id: work._id,
          tickets: work.tickets,
          ticketsCategories:
            work.tickets?.map((ticket) => ({
              _id: ticket.categoryId?._id.toString(),
              title: ticket.categoryId?.title,
              alwaysWithinPlan: ticket.categoryId?.alwaysWithinPlan,
            })) || [],
          description: work.description,
          withinPlan: work.withinPlan,
          finishedBy: work.finishedBy
            ? `${work.finishedBy.lastName} ${work.finishedBy.firstName}`
            : "",
          startedAt: work.startedAt,
          finishedAt: work.finishedAt,
          finances: work.finances,
        }));

        // 9. Filter service plans more efficiently
        const companyId = company._id.toString();
        const companyServicePlans = servicePlans.filter((plan) =>
          plan.companies.some((c) => c._id.toString() === companyId),
        );

        return {
          company,
          servicePlans: companyServicePlans,
          tickets,
          works: worksData,
        };
      }),
    );

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch summary report preview",
      details: error.message,
    });
  }
};

exports.getPersonalReport = async (req, res) => {
  const { userId } = await getAuthData(req);

  const date = req.params.date;

  const periodFrom = new Date(
    new Date(date).getFullYear(),
    new Date(date).getMonth(),
    1,
  );

  const periodTo = new Date(
    new Date(date).getFullYear(),
    new Date(date).getMonth() + 1,
    0,
  );

  const works = await Work.find({
    "finishedBy._id": userId,
    finishedAt: {
      $gte: periodFrom,
      $lte: periodTo,
    },
  });

  let worksData = [];

  for (let work of works) {
    const tickets = await Ticket.find({ _id: { $in: work.tickets } })
      .populate("applicantId")
      .populate("categoryId");

    if (!tickets || tickets.length === 0) {
      console.warn(`No tickets found for work ${work._id}, skipping...`);
      continue;
    }

    const company = await Company.findById(tickets[0].company._id);

    if (!company) {
      console.warn(`Company not found for work ${work._id}, skipping...`);
      continue;
    }

    let servicePlans = [];
    const servicePlansIds = company?.servicePlans || [];
    for (let planId of servicePlansIds) {
      const servicePlan = await ServicePlan.findById(planId);
      if (servicePlan) {
        servicePlans.push(servicePlan);
      }
    }

    const ticketsNums = tickets?.map((ticket) => ticket.num);
    const ticketsApplicants = tickets?.map(
      (ticket) =>
        `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`,
    );
    const ticketsCategories = tickets?.map((ticket) => ({
      _id: ticket.categoryId?._id.toString(),
      title: ticket.categoryId?.title,
    }));

    worksData.push({
      _id: work._id,
      company: company,
      servicePlan: servicePlans[0],
      finances: work.finances,
      tickets: work.tickets,
      ticketsNums: ticketsNums || [],
      ticketsApplicants: ticketsApplicants || [],
      ticketsCategories: ticketsCategories || [],
      description: work.description,
      withinPlan: work.withinPlan,
      finishedBy: `${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`,
      startedAt: work.startedAt,
      finishedAt: work.finishedAt,
    });
  }

  res.status(200).json({ works: worksData });
};

exports.confirmWorksByContractor = async (req, res, next) => {
  try {
    const {
      relatedWorks = [],
      companyId,
      servicePlanId,
      price,
      additionalPrice,
    } = req.body;

    const authedUser = await getAuthData(req);

    // creating a report document
    const company = await Company.findById(companyId);
    const servicePlan = await ServicePlan.findById(servicePlanId);

    if (!company) {
      return next(new AppError(`Company with id ${companyId} not found`, 404));
    }

    if (!servicePlan) {
      return next(
        new AppError(`Service plan with id ${servicePlanId} not found`, 404),
      );
    }

    const currentServicePlan = company.servicePlans.filter(
      (plan) => plan._id.toString() === servicePlan._id.toString(),
    )[0];

    const newReport = new ServicePlanReport({
      company: company,
      servicePlan: servicePlan,
      works: relatedWorks.map((work) => work._id),
      status: currentServicePlan?.customerApprovalRequired
        ? "pendingApproval"
        : "approved",
      price: +price,
      additionalPrice: +additionalPrice,
      periodFrom: new Date(
        new Date(relatedWorks[0].finishedAt).getFullYear(),
        new Date(relatedWorks[0].finishedAt).getMonth(),
        1,
      ),
      periodTo: new Date(
        new Date(relatedWorks[0].finishedAt).getFullYear(),
        new Date(relatedWorks[0].finishedAt).getMonth() + 1,
        0,
      ),
      createdBy: authedUser,
      updatedBy: authedUser,
    });

    await newReport.save();

    //  updating works and archiving tickets
    for (let work of relatedWorks) {
      const updatedWork = await Work.findById(work._id);

      if (!updatedWork) {
        console.warn(`Work with ID ${work._id} not found, skipping...`);
        continue;
      }

      if (authedUser.permissions.canConfirmReportActions) {
        updatedWork.finances.status =
          currentServicePlan?.customerApprovalRequired
            ? "pendingApproval"
            : "approved";
        updatedWork.finances.contractor = {
          isConfirmed: true,
          confirmedAt: new Date(),
          confirmedBy: authedUser,
        };

        for (let ticketId of updatedWork.tickets) {
          const ticket = await Ticket.findById(ticketId);

          if (ticket) {
            if (ticket.isClosed) {
              ticket.isArchived = true;
            }

            await ticket.save();
          }
        }

        await updatedWork.save();
      }
    }

    res.status(201).json({ report: newReport });
  } catch (error) {
    next(
      new AppError("Failed to fetch summary report preview", 500, true, error),
    );
  }
};

exports.createInvoice = async (req, res, next) => {
  try {
    const { reportId, invoiceNumber, invoiceDate } = req.body;
    const report = await ServicePlanReport.findById(reportId);

    if (!report) {
      return next(new AppError(`Report with id ${reportId} not found`, 404));
    }

    report.invoice = {
      number: invoiceNumber,
      date: invoiceDate,
    };
    report.status = "awaitingPayment";

    await report.save();

    res.status(200).json({ report: report });
  } catch (error) {
    next(
      new AppError(
        `Failed to create invoice for report with id ${req.body.reportId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.confirmPayment = async (req, res, next) => {
  try {
    const { reportId, fullPaymentDate } = req.body;
    const report = await ServicePlanReport.findById(reportId);

    if (!report) {
      return next(new AppError(`Report with id ${reportId} not found`, 404));
    }

    report.invoice.fullyPaidAt = fullPaymentDate;
    report.status = "paid";

    await report.save();

    res.status(200).json({ report: report });
  } catch (error) {
    next(
      new AppError(
        `Failed to confirm payment for report with id ${req.body.reportId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const report = await ServicePlanReport.findById(req.body.reportId);

    if (report) {
      for (let workId of report.works) {
        const work = await Work.findById(workId);

        if (work) {
          work.finances = { status: "preview" };
          await work.save();
        }
      }

      await ServicePlanReport.deleteOne({ _id: req.body.reportId });
      res.status(204).end();
    } else {
      return next(
        new AppError(`Report with id ${req.body.reportId} not found`, 404),
      );
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete report with id ${req.body.reportId}`,
        500,
        true,
        error,
      ),
    );
  }
};

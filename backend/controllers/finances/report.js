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
    })
      .populate({
        path: "works",
        populate: {
          path: "tickets",
          select: "-htmlDescription -attachments",
          populate: {
            path: "applicantId",
            select:
              "-password -email -phone -address -createdAt -updatedAt -__v",
          },
        },
      })
      .populate({
        path: "company",
      })
      .populate({
        path: "servicePlan",
      });

    res.status(200).json(reports);
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

exports.archive = async (req, res, next) => {
  try {
    const { reportId } = req.body;
    const report = await ServicePlanReport.findById(reportId);

    if (!report) {
      return next(new AppError(`Report with id ${reportId} not found`, 404));
    }

    if (report.status !== "paid") {
      return next(new AppError("Only paid reports can be archived", 400));
    }

    report.status = "archived";
    await report.save();

    res.status(200).json({ report: report });
  } catch (error) {
    next(
      new AppError(
        `Failed to archive report with id ${req.body.reportId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.getEmployeeReport = async (req, res, next) => {
  try {
    const { periodFrom, periodTo } = req.body;

    const fromDate = new Date(periodFrom);
    let toDate = new Date(periodTo);
    toDate.setHours(23, 59, 59, 999);

    // Find all approved reports that overlap with the period
    const approvedReports = await ServicePlanReport.find({
      status: { $in: ["approved", "awaitingPayment", "paid", "archived"] },
      $or: [
        {
          // Report starts within our period
          periodFrom: { $gte: fromDate, $lte: toDate },
        },
        {
          // Report ends within our period
          periodTo: { $gte: fromDate, $lte: toDate },
        },
        {
          // Report spans our entire period
          periodFrom: { $lte: fromDate },
          periodTo: { $gte: toDate },
        },
      ],
    })
      .populate({
        path: "works",
        populate: {
          path: "tickets",
          select: "num categoryId applicantId",
          populate: [
            { path: "categoryId", select: "title" },
            { path: "applicantId", select: "firstName lastName" },
          ],
        },
      })
      .populate("company", "fullTitle alias")
      .populate("servicePlan", "title");

    // Group works by employee
    const employeeWorksMap = new Map();

    for (const report of approvedReports) {
      for (const work of report.works) {
        if (!work.finishedBy || !work.finishedBy._id) continue;

        const employeeId = work.finishedBy._id.toString();
        const employeeName = `${work.finishedBy.lastName} ${work.finishedBy.firstName}`;

        if (!employeeWorksMap.has(employeeId)) {
          employeeWorksMap.set(employeeId, {
            employee: {
              _id: employeeId,
              name: employeeName,
              firstName: work.finishedBy.firstName,
              lastName: work.finishedBy.lastName,
            },
            works: [],
            totalWorksCount: 0,
            totalDuration: 0,
          });
        }

        const employeeData = employeeWorksMap.get(employeeId);

        // Calculate work duration
        const duration =
          work.startedAt && work.finishedAt
            ? new Date(work.finishedAt) - new Date(work.startedAt)
            : 0;

        // Prepare work data
        const workData = {
          _id: work._id,
          description: work.description,
          startedAt: work.startedAt,
          finishedAt: work.finishedAt,
          duration: duration,
          company: report.company,
          servicePlan: report.servicePlan,
          report: {
            _id: report._id,
            periodFrom: report.periodFrom,
            periodTo: report.periodTo,
            status: report.status,
          },
          tickets: work.tickets.map((ticket) => ({
            _id: ticket._id,
            num: ticket.num,
            category: ticket.categoryId?.title || "Без категории",
            applicant: ticket.applicantId
              ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
              : "Не указан",
          })),
          withinPlan: work.withinPlan,
        };

        employeeData.works.push(workData);
        employeeData.totalWorksCount++;
        employeeData.totalDuration += duration;
      }
    }

    // Convert map to array and sort by employee name
    const employeeReports = Array.from(employeeWorksMap.values()).sort((a, b) =>
      a.employee.name.localeCompare(b.employee.name),
    );

    // Calculate totals
    const totals = {
      totalEmployees: employeeReports.length,
      totalWorks: employeeReports.reduce(
        (sum, emp) => sum + emp.totalWorksCount,
        0,
      ),
      totalDuration: employeeReports.reduce(
        (sum, emp) => sum + emp.totalDuration,
        0,
      ),
    };

    res.status(200).json({
      employees: employeeReports,
      totals: totals,
      period: {
        from: fromDate,
        to: toDate,
      },
    });
  } catch (error) {
    next(new AppError("Failed to generate employee report", 500, true, error));
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

exports.getPersonalReportByRange = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const { from, to } = req.query;

    if (!from || !to) {
      return next(new AppError("From and to dates are required", 400));
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999); // End of day

    const works = await Work.find({
      "finishedBy._id": userId,
      finishedAt: {
        $gte: fromDate,
        $lte: toDate,
      },
    })
      .populate({
        path: "tickets",
        select: "num company applicantId categoryId description",
        populate: [
          { path: "categoryId", select: "title alwaysWithinPlan" },
          { path: "applicantId", select: "lastName firstName" },
        ],
      })
      .lean();

    let worksData = [];

    for (let work of works) {
      if (!work.tickets || work.tickets.length === 0) {
        continue;
      }

      const companyId = work.tickets[0].company._id;
      const company = await Company.findById(companyId).lean();

      if (!company) {
        continue;
      }

      let servicePlan = null;
      if (company.servicePlans && company.servicePlans.length > 0) {
        servicePlan = await ServicePlan.findById(
          company.servicePlans[0],
        ).lean();
      }

      worksData.push({
        _id: work._id,
        company: company,
        servicePlan: servicePlan,
        finances: work.finances,
        tickets: work.tickets,
        description: work.description,
        withinPlan: work.withinPlan,
        startedAt: work.startedAt,
        finishedAt: work.finishedAt,
        createdAt: work.createdAt,
        status: work.finances?.status || "completed",
      });
    }

    res.status(200).json({ works: worksData });
  } catch (error) {
    next(new AppError("Failed to fetch personal report", 500, true, error));
  }
};

exports.getPersonalPreviewWorks = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const { from, to } = req.query;

    if (!from || !to) {
      return next(new AppError("From and to dates are required", 400));
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999); // End of day

    const works = await Work.find({
      "finishedBy._id": userId,
      createdAt: {
        $gte: fromDate,
        $lte: toDate,
      },
      $or: [
        { "finances.status": { $exists: false } },
        { "finances.status": "preview" },
      ],
    })
      .populate({
        path: "tickets",
        select: "num company applicantId categoryId description",
        populate: [
          { path: "categoryId", select: "title alwaysWithinPlan" },
          { path: "applicantId", select: "lastName firstName" },
        ],
      })
      .lean();

    let worksData = [];

    for (let work of works) {
      if (!work.tickets || work.tickets.length === 0) {
        continue;
      }

      const companyId = work.tickets[0].company._id;
      const company = await Company.findById(companyId).lean();

      if (!company) {
        continue;
      }

      let servicePlan = null;
      if (company.servicePlans && company.servicePlans.length > 0) {
        servicePlan = await ServicePlan.findById(
          company.servicePlans[0],
        ).lean();
      }

      worksData.push({
        _id: work._id,
        company: company,
        servicePlan: servicePlan,
        finances: work.finances,
        tickets: work.tickets,
        description: work.description,
        withinPlan: work.withinPlan,
        startedAt: work.startedAt,
        finishedAt: work.finishedAt,
        createdAt: work.createdAt,
        status: work.finances?.status || "preview",
      });
    }

    res.status(200).json({ works: worksData });
  } catch (error) {
    next(
      new AppError("Failed to fetch personal preview works", 500, true, error),
    );
  }
};

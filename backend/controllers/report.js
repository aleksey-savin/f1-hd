const Company = require("../models//company");
const User = require("../models//user");
const Category = require("../models//ticketCategory");
const Work = require("../models//work");
const { Ticket } = require("../models//ticket");
const getAuthData = require("../middleware/getAuthData");

const { AppError } = require("../middleware/errorHandling");

exports.getFormData = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    let companies = [];

    if (!authedUser.isEndUser) {
      companies = await Company.find({}).sort({ alias: 1 });
    } else {
      companies = await Company.find({ _id: authedUser.company._id });
    }

    const categories = await Category.find({ isActive: true }).sort({
      title: 1,
    });

    const perfomers = await User.find({
      $and: [{ "permissions.canPerformTickets": true }, { isActive: true }],
    });

    res.status(200).json({
      message: "Form data fetched successfully",
      companies: companies,
      categories: categories,
      perfomers: perfomers,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch tickets report form data`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.filterWorks = async (req, res, next) => {
  try {
    const { company, category, from, to } = req.body;

    const fromDate = new Date(from);

    let toDate = new Date(to);
    toDate = toDate.setDate(toDate.getDate() + 1);

    const works = await Work.find({
      company: company._id,
      finishedAt: { $gte: fromDate, $lte: toDate },
    });

    let worksData = [];

    for (let work of works) {
      const tickets = await Ticket.find({
        _id: { $in: work.tickets },
      })
        .populate("categoryId")
        .populate("applicantId");

      const ticketsNums = tickets?.map((ticket) => ticket.num);
      const ticketsApplicants = tickets?.map(
        (ticket) =>
          `${ticket.applicantId?.lastName} ${ticket.applicantId?.firstName}`,
      );
      const ticketsCategories = tickets?.map((ticket) => ({
        _id: ticket.categoryId?._id.toString(),
        title: ticket.categoryId?.title,
      }));

      if (Object.keys(category).length === 0) {
        worksData.push({
          _id: work._id,
          ticketsNums: ticketsNums || [],
          ticketsApplicants: ticketsApplicants || [],
          ticketsCategories: ticketsCategories || [],
          description: work.description,
          finishedBy: `${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`,
          startedAt: work.startedAt,
          finishedAt: work.finishedAt,
        });
      } else {
        if (
          ticketsCategories
            .map((category) => category._id)
            .includes(category._id.toString())
        ) {
          worksData.push({
            _id: work._id,
            ticketsNums: ticketsNums || [],
            ticketsApplicants: ticketsApplicants || [],
            ticketsCategories:
              ticketsCategories.map((category) => category.title) || [],
            description: work.description,
            finishedBy: `${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`,
            startedAt: work.startedAt,
            finishedAt: work.finishedAt,
          });
        }
      }
    }

    const totalTime = (works) => {
      let total = 0;
      for (let work of works) {
        const duration = new Date(work.finishedAt) - new Date(work.startedAt);

        total += duration;
      }
      return total;
    };

    res.status(200).json({
      totalTime: totalTime(worksData),
      works: worksData,
    });
  } catch (error) {
    next(new AppError(`Failed to filter works for report`, 500, true, error));
  }
};

exports.getCompanySummary = async (req, res, next) => {
  try {
    const { from, to } = req.body;
    const authedUser = await getAuthData(req);

    const fromDate = new Date(from);
    let toDate = new Date(to);
    toDate = toDate.setDate(toDate.getDate() + 1);

    // Получаем компании в зависимости от роли пользователя
    let companies = [];
    if (!authedUser.isEndUser) {
      companies = await Company.find({}).sort({ alias: 1 });
    } else {
      companies = await Company.find({ _id: authedUser.company._id });
    }

    const companySummaries = [];

    for (let company of companies) {
      // Получаем все работы компании за период
      const works = await Work.find({
        company: company._id,
        finishedAt: { $gte: fromDate, $lte: toDate },
      });

      if (works.length === 0) continue;

      // Получаем все заявки, связанные с работами
      const allTicketIds = works.reduce((acc, work) => {
        return acc.concat(work.tickets);
      }, []);

      const uniqueTicketIds = [
        ...new Set(allTicketIds.map((id) => id.toString())),
      ];
      const totalTickets = uniqueTicketIds.length;

      // Разделяем работы по типу (выезды/удаленные)
      const onSiteWorks = works.filter((work) => work.visitRequired === true);
      const remoteWorks = works.filter((work) => work.visitRequired !== true);

      // Вычисляем общее время
      const calculateTotalTime = (worksList) => {
        return worksList.reduce((total, work) => {
          if (work.startedAt && work.finishedAt) {
            return (
              total + (new Date(work.finishedAt) - new Date(work.startedAt))
            );
          }
          return total;
        }, 0);
      };

      const totalOnSiteTime = calculateTotalTime(onSiteWorks);
      const totalRemoteTime = calculateTotalTime(remoteWorks);
      const totalTime = totalOnSiteTime + totalRemoteTime;

      // Статистика по исполнителям
      const executorStats = {};
      works.forEach((work) => {
        if (work.finishedBy && work.finishedBy._id) {
          const executorId = work.finishedBy._id.toString();
          const executorName = `${work.finishedBy.lastName} ${work.finishedBy.firstName}`;

          if (!executorStats[executorId]) {
            executorStats[executorId] = {
              name: executorName,
              totalWorks: 0,
              totalTime: 0,
              onSiteWorks: 0,
              remoteWorks: 0,
              onSiteTime: 0,
              remoteTime: 0,
            };
          }

          executorStats[executorId].totalWorks++;

          if (work.startedAt && work.finishedAt) {
            const workDuration =
              new Date(work.finishedAt) - new Date(work.startedAt);
            executorStats[executorId].totalTime += workDuration;

            if (work.visitRequired === true) {
              executorStats[executorId].onSiteWorks++;
              executorStats[executorId].onSiteTime += workDuration;
            } else {
              executorStats[executorId].remoteWorks++;
              executorStats[executorId].remoteTime += workDuration;
            }
          }
        }
      });

      companySummaries.push({
        company: {
          _id: company._id,
          alias: company.alias,
          name: company.name,
        },
        totalTickets,
        totalWorks: works.length,
        totalTime,
        onSite: {
          count: onSiteWorks.length,
          time: totalOnSiteTime,
        },
        remote: {
          count: remoteWorks.length,
          time: totalRemoteTime,
        },
        executors: Object.values(executorStats),
      });
    }

    res.status(200).json({
      message: "Company summary report generated successfully",
      period: { from, to },
      companies: companySummaries,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to generate company summary report`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.getTrendsAnalysis = async (req, res, next) => {
  try {
    const {
      period,
      grouping,
      startDate: customStartDate,
      endDate: customEndDate,
    } = req.body;
    const authedUser = await getAuthData(req);

    // Определяем диапазон дат
    let startDate, endDate;
    if (period === "12months") {
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999); // Конец текущего дня
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 12);
      startDate.setHours(0, 0, 0, 0); // Начало дня 12 месяцев назад
    } else if (period === "currentYear") {
      const currentYear = new Date().getFullYear();
      startDate = new Date(currentYear, 0, 1, 0, 0, 0, 0);
      endDate = new Date(currentYear, 11, 31, 23, 59, 59, 999);
    } else if (period === "lastYear") {
      const lastYear = new Date().getFullYear() - 1;
      startDate = new Date(lastYear, 0, 1, 0, 0, 0, 0);
      endDate = new Date(lastYear, 11, 31, 23, 59, 59, 999);
    } else if (period === "custom" && customStartDate && customEndDate) {
      startDate = new Date(customStartDate);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(customEndDate);
      endDate.setHours(23, 59, 59, 999);
    } else {
      throw new Error("Invalid period specified");
    }

    // Получаем компании
    let companies = [];
    if (!authedUser.isEndUser) {
      companies = await Company.find({}).sort({ alias: 1 });
    } else {
      companies = await Company.find({ _id: authedUser.company._id });
    }

    const trendsData = [];

    // Генерируем периоды (месяцы/кварталы/недели)
    const periods = generatePeriods(startDate, endDate, grouping);

    for (let company of companies) {
      const companyTrends = {
        company: {
          _id: company._id,
          alias: company.alias,
          name: company.name,
        },
        periods: [],
      };

      let hasData = false;

      for (let period of periods) {
        // Получаем работы за каждый период
        const works = await Work.find({
          company: company._id,
          finishedAt: { $gte: period.start, $lte: period.end },
        }).populate("finishedBy");

        // Получаем все заявки, связанные с работами
        const allTicketIds = works.reduce((acc, work) => {
          return acc.concat(work.tickets);
        }, []);

        const uniqueTicketIds = [
          ...new Set(allTicketIds.map((id) => id.toString())),
        ];

        // Разделяем работы по типу (выезды/удаленные)
        const onSiteWorks = works.filter((work) => work.visitRequired === true);
        const remoteWorks = works.filter((work) => work.visitRequired !== true);

        // Вычисляем общее время
        const calculateTotalTime = (worksList) => {
          return worksList.reduce((total, work) => {
            if (work.startedAt && work.finishedAt) {
              return (
                total + (new Date(work.finishedAt) - new Date(work.startedAt))
              );
            }
            return total;
          }, 0);
        };

        const totalOnSiteTime = calculateTotalTime(onSiteWorks);
        const totalRemoteTime = calculateTotalTime(remoteWorks);
        const totalTime = totalOnSiteTime + totalRemoteTime;

        // Статистика по исполнителям для периода
        const executorStats = {};
        works.forEach((work) => {
          if (work.finishedBy && work.finishedBy._id) {
            const executorId = work.finishedBy._id.toString();
            const executorName = `${work.finishedBy.lastName} ${work.finishedBy.firstName}`;

            if (!executorStats[executorId]) {
              executorStats[executorId] = {
                name: executorName,
                totalWorks: 0,
                totalTime: 0,
              };
            }

            executorStats[executorId].totalWorks++;

            if (work.startedAt && work.finishedAt) {
              const workDuration =
                new Date(work.finishedAt) - new Date(work.startedAt);
              executorStats[executorId].totalTime += workDuration;
            }
          }
        });

        const periodData = {
          ...period,
          totalTickets: uniqueTicketIds.length,
          totalWorks: works.length,
          totalTime,
          onSite: {
            count: onSiteWorks.length,
            time: totalOnSiteTime,
          },
          remote: {
            count: remoteWorks.length,
            time: totalRemoteTime,
          },
          executors: Object.values(executorStats),
        };

        companyTrends.periods.push(periodData);

        if (works.length > 0) {
          hasData = true;
        }
      }

      if (hasData) {
        trendsData.push(companyTrends);
      }
    }

    res.status(200).json({
      message: "Trends analysis generated successfully",
      data: trendsData,
      meta: {
        period,
        grouping,
        startDate,
        endDate,
        periodsCount: periods.length,
      },
    });
  } catch (error) {
    next(new AppError(`Failed to generate trends analysis`, 500, true, error));
  }
};

// Вспомогательная функция для генерации периодов
function generatePeriods(startDate, endDate, grouping) {
  const periods = [];

  if (grouping === "month") {
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (start < endDate) {
      const periodStart = new Date(start);
      const periodEnd = new Date(
        start.getFullYear(),
        start.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );

      const label = start.toLocaleDateString("ru-RU", {
        year: "numeric",
        month: "long",
      });

      periods.push({
        start: periodStart,
        end: periodEnd > endDate ? new Date(endDate) : periodEnd,
        label: label,
        key: periodStart.toISOString().slice(0, 10),
      });

      start.setMonth(start.getMonth() + 1);
    }
  } else if (grouping === "quarter") {
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    const startQuarter = Math.floor(startDate.getMonth() / 3);

    for (let year = startYear; year <= endYear; year++) {
      const firstQuarter = year === startYear ? startQuarter : 0;
      const lastQuarter =
        year === endYear ? Math.floor(endDate.getMonth() / 3) : 3;

      for (let quarter = firstQuarter; quarter <= lastQuarter; quarter++) {
        const periodStart = new Date(year, quarter * 3, 1, 0, 0, 0, 0);
        const periodEnd = new Date(year, quarter * 3 + 3, 0, 23, 59, 59, 999);

        // Проверяем, что период пересекается с запрашиваемым диапазоном
        if (periodStart > endDate || periodEnd < startDate) {
          continue;
        }

        const label = `${quarter + 1} квартал ${year}`;

        periods.push({
          start: periodStart < startDate ? new Date(startDate) : periodStart,
          end: periodEnd > endDate ? new Date(endDate) : periodEnd,
          label: label,
          key: periodStart.toISOString().slice(0, 10),
        });
      }
    }
  } else if (grouping === "week") {
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    while (current < endDate) {
      const periodStart = new Date(current);
      const periodEnd = new Date(current);
      periodEnd.setDate(periodEnd.getDate() + 6);
      periodEnd.setHours(23, 59, 59, 999);

      const weekStart = periodStart.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
      });
      const weekEndFormatted =
        periodEnd > endDate ? new Date(endDate) : periodEnd;
      const weekEndStr = weekEndFormatted.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
      });
      const label = `${weekStart} - ${weekEndStr}`;

      periods.push({
        start: periodStart,
        end: periodEnd > endDate ? new Date(endDate) : periodEnd,
        label: label,
        key: periodStart.toISOString().slice(0, 10),
      });

      current.setDate(current.getDate() + 7);
    }
  }

  return periods;
}

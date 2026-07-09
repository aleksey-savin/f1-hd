const Company = require("../models/company");
const User = require("../models/user");
const Category = require("../models/ticketCategory");
const Work = require("../models/work");
const { Ticket } = require("../models/ticket");
const Subdivision = require("../models/subdivision");
const Preferences = require("../models/preferences");
const getAuthData = require("../middleware/getAuthData");
const { resolveTimezone } = require("../utils/datetime");

const dayjs = require("dayjs");
const dayjsUtc = require("dayjs/plugin/utc");
const dayjsTimezone = require("dayjs/plugin/timezone");
dayjs.extend(dayjsUtc);
dayjs.extend(dayjsTimezone);

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

    // Получаем подразделения для клиентов
    let subdivisions = [];
    if (authedUser.isEndUser) {
      subdivisions = await Subdivision.find({
        company: authedUser.company._id,
      }).sort({ name: 1 });
    }

    const companySummaries = [];

    for (let company of companies) {
      // Получаем все работы компании за период
      const works = await Work.find({
        company: company._id,
        finishedAt: { $gte: fromDate, $lte: toDate },
      })
        .populate({
          path: "tickets",
          populate: {
            path: "routineTask",
          },
        })
        .populate({
          path: "finishedBy._id",
          populate: {
            path: "subdivision",
          },
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

      // Группируем работы по подразделениям для клиентов
      const subdivisionStats = {};
      if (authedUser.isEndUser && subdivisions.length > 0) {
        // Создаем статистику для всех подразделений
        subdivisions.forEach((subdivision) => {
          subdivisionStats[subdivision._id.toString()] = {
            _id: subdivision._id.toString(),
            name: subdivision.name,
            totalWorks: 0,
            totalTime: 0,
            onSiteTime: 0,
            remoteTime: 0,
            routineTaskTime: 0,
          };
        });

        // Добавляем категорию "Без подразделения"
        subdivisionStats["no_subdivision"] = {
          _id: "no_subdivision",
          name: "Без подразделения",
          totalWorks: 0,
          totalTime: 0,
          onSiteTime: 0,
          remoteTime: 0,
          routineTaskTime: 0,
        };

        works.forEach((work) => {
          if (work.finishedBy && work.finishedBy._id) {
            let subdivisionId = null;
            if (work.finishedBy._id.subdivision) {
              subdivisionId = work.finishedBy._id.subdivision._id.toString();
            } else {
              // Если у исполнителя нет подразделения
              subdivisionId = "no_subdivision";
            }

            if (subdivisionId && subdivisionStats[subdivisionId]) {
              subdivisionStats[subdivisionId].totalWorks++;

              if (work.startedAt && work.finishedAt) {
                const workDuration =
                  new Date(work.finishedAt) - new Date(work.startedAt);
                subdivisionStats[subdivisionId].totalTime += workDuration;

                const isRoutineTask = work.tickets.some(
                  (ticket) => ticket.routineTask,
                );

                if (isRoutineTask) {
                  subdivisionStats[subdivisionId].routineTaskTime +=
                    workDuration;
                } else if (work.visitRequired === true) {
                  subdivisionStats[subdivisionId].onSiteTime += workDuration;
                } else {
                  subdivisionStats[subdivisionId].remoteTime += workDuration;
                }
              }
            }
          }
        });
      }

      // Находим регламентные работы (работы с билетами, у которых есть routineTask)
      const routineTaskWorks = works.filter((work) =>
        work.tickets.some((ticket) => ticket.routineTask),
      );

      // Разделяем работы по типу (выезды/удаленные), исключая регламентные
      const onSiteWorks = works.filter(
        (work) =>
          work.visitRequired === true &&
          !work.tickets.some((ticket) => ticket.routineTask),
      );
      const remoteWorks = works.filter(
        (work) =>
          work.visitRequired !== true &&
          !work.tickets.some((ticket) => ticket.routineTask),
      );

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
      const totalRoutineTaskTime = calculateTotalTime(routineTaskWorks);
      const totalTime =
        totalOnSiteTime + totalRemoteTime + totalRoutineTaskTime;

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
              routineTaskWorks: 0,
              routineTaskTime: 0,
            };
          }

          executorStats[executorId].totalWorks++;

          if (work.startedAt && work.finishedAt) {
            const workDuration =
              new Date(work.finishedAt) - new Date(work.startedAt);
            executorStats[executorId].totalTime += workDuration;

            // Проверяем является ли работа регламентной
            const isRoutineTask = work.tickets.some(
              (ticket) => ticket.routineTask,
            );

            if (isRoutineTask) {
              executorStats[executorId].routineTaskWorks++;
              executorStats[executorId].routineTaskTime += workDuration;
            } else {
              // Определяем тип работы (выездная или удаленная) только для НЕ регламентных
              if (work.visitRequired === true) {
                executorStats[executorId].onSiteWorks++;
                executorStats[executorId].onSiteTime += workDuration;
              } else {
                executorStats[executorId].remoteWorks++;
                executorStats[executorId].remoteTime += workDuration;
              }
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
        routineTask: {
          count: routineTaskWorks.length,
          time: totalRoutineTaskTime,
        },
        executors: authedUser.isEndUser ? [] : Object.values(executorStats),
        subdivisions: authedUser.isEndUser
          ? Object.values(subdivisionStats)
          : [],
      });
    }

    res.status(200).json({
      message: "Company summary",
      period: { from, to },
      companies: companySummaries,
      subdivisions: authedUser.isEndUser ? subdivisions : [],
      isClientView: authedUser.isEndUser,
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

    // Диапазон дат — по настенным часам БИЗНЕС-таймзоны (сервер живёт в UTC:
    // серверно-локальные границы резали периоды по UTC-полуночи и утаскивали
    // работы первых часов месяца/года в соседний бакет).
    const prefs = await Preferences.findOne({});
    const tz = resolveTimezone(prefs);
    const now = dayjs.tz(new Date(), tz);

    let startDate, endDate;
    if (period === "12months") {
      endDate = now.endOf("day").toDate();
      startDate = now.subtract(12, "month").startOf("day").toDate();
    } else if (period === "currentYear") {
      startDate = now.startOf("year").toDate();
      endDate = now.endOf("year").toDate();
    } else if (period === "lastYear") {
      const lastYear = now.subtract(1, "year");
      startDate = lastYear.startOf("year").toDate();
      endDate = lastYear.endOf("year").toDate();
    } else if (period === "custom" && customStartDate && customEndDate) {
      startDate = dayjs.tz(customStartDate, tz).startOf("day").toDate();
      endDate = dayjs.tz(customEndDate, tz).endOf("day").toDate();
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
    const periods = generatePeriods(startDate, endDate, grouping, tz);

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
        })
          .populate("finishedBy")
          .populate({
            path: "tickets",
            populate: {
              path: "routineTask",
            },
          });

        // Получаем все заявки, связанные с работами
        const allTicketIds = works.reduce((acc, work) => {
          return acc.concat(work.tickets);
        }, []);

        const uniqueTicketIds = [
          ...new Set(allTicketIds.map((id) => id.toString())),
        ];

        // Находим регламентные работы (работы с билетами, у которых есть routineTask)
        const routineTaskWorks = works.filter((work) =>
          work.tickets.some((ticket) => ticket.routineTask),
        );

        // Разделяем работы по типу (выезды/удаленные), исключая регламентные
        const onSiteWorks = works.filter(
          (work) =>
            work.visitRequired === true &&
            !work.tickets.some((ticket) => ticket.routineTask),
        );
        const remoteWorks = works.filter(
          (work) =>
            work.visitRequired !== true &&
            !work.tickets.some((ticket) => ticket.routineTask),
        );

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
        const totalRoutineTaskTime = calculateTotalTime(routineTaskWorks);
        const totalTime =
          totalOnSiteTime + totalRemoteTime + totalRoutineTaskTime;

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
          routineTask: {
            count: routineTaskWorks.length,
            time: totalRoutineTaskTime,
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

// Вспомогательная функция для генерации периодов. Границы и подписи — по
// настенным часам бизнес-таймзоны `tz` (dayjs.tz), а не серверного UTC.
function generatePeriods(startDate, endDate, grouping, tz) {
  const periods = [];
  const rangeStart = dayjs.tz(startDate, tz);
  const rangeEnd = dayjs.tz(endDate, tz);

  const clampEnd = (periodEnd) =>
    periodEnd.isAfter(rangeEnd) ? rangeEnd.toDate() : periodEnd.toDate();
  const labelDate = (instant, options) =>
    instant.toLocaleDateString("ru-RU", { timeZone: tz, ...options });

  if (grouping === "month") {
    let cursor = rangeStart.startOf("month");
    while (cursor.toDate() < endDate) {
      const periodEnd = cursor.endOf("month");

      periods.push({
        start: cursor.toDate(),
        end: clampEnd(periodEnd),
        label: labelDate(cursor.toDate(), {
          year: "numeric",
          month: "long",
        }),
        key: cursor.format("YYYY-MM-DD"),
      });

      cursor = cursor.add(1, "month").startOf("month");
    }
  } else if (grouping === "quarter") {
    const startYear = rangeStart.year();
    const endYear = rangeEnd.year();
    const startQuarter = Math.floor(rangeStart.month() / 3);

    for (let year = startYear; year <= endYear; year++) {
      const firstQuarter = year === startYear ? startQuarter : 0;
      const lastQuarter =
        year === endYear ? Math.floor(rangeEnd.month() / 3) : 3;

      for (let quarter = firstQuarter; quarter <= lastQuarter; quarter++) {
        const periodStart = rangeStart
          .year(year)
          .month(quarter * 3)
          .startOf("month");
        const periodEnd = periodStart.add(2, "month").endOf("month");

        // Проверяем, что период пересекается с запрашиваемым диапазоном
        if (periodStart.toDate() > endDate || periodEnd.toDate() < startDate) {
          continue;
        }

        periods.push({
          start:
            periodStart.toDate() < startDate
              ? new Date(startDate)
              : periodStart.toDate(),
          end: clampEnd(periodEnd),
          label: `${quarter + 1} квартал ${year}`,
          key: periodStart.format("YYYY-MM-DD"),
        });
      }
    }
  } else if (grouping === "week") {
    let cursor = rangeStart.startOf("day");

    while (cursor.toDate() < endDate) {
      const periodEnd = cursor.add(6, "day").endOf("day");
      const periodEndClamped = clampEnd(periodEnd);

      const weekStart = labelDate(cursor.toDate(), {
        day: "2-digit",
        month: "2-digit",
      });
      const weekEndStr = labelDate(periodEndClamped, {
        day: "2-digit",
        month: "2-digit",
      });

      periods.push({
        start: cursor.toDate(),
        end: periodEndClamped,
        label: `${weekStart} - ${weekEndStr}`,
        key: cursor.format("YYYY-MM-DD"),
      });

      cursor = cursor.add(7, "day").startOf("day");
    }
  }

  return periods;
}

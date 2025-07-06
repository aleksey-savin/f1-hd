const { Ticket } = require("../models//ticket");
const Company = require("../models//company");
const Work = require("../models//work");
const User = require("../models//user");
const Preferences = require("../models//preferences");

const getAuthData = require("../middleware/getAuthData");
const { AppError } = require("../middleware/errorHandling");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

exports.getAll = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const preferences = await Preferences.findOne({});
  const prefsTz = preferences.timezone;

  const startOfDay = dayjs.tz(new Date(), prefsTz).startOf("day");
  const endOfDay = dayjs.tz(new Date(), prefsTz).endOf("day");

  // const startOfWeek = dayjs.tz(new Date(), prefsTz).startOf("week");
  // const endOfWeek = dayjs.tz(new Date(), prefsTz).endOf("week");

  const startOfMonth = dayjs.tz(new Date(), prefsTz).startOf("month");
  const endOfMonth = dayjs.tz(new Date(), prefsTz).endOf("month");

  const totalTime = (works) => {
    let total = 0;
    for (let work of works) {
      const duration = new Date(work.finishedAt) - new Date(work.startedAt);

      total += duration;
    }
    return total;
  };

  const sortByTotalTime = (arr) => {
    return arr.sort((a, b) => b.totalTime - a.totalTime);
  };

  const sortByIsActive = (arr) => {
    return arr.sort((a, b) =>
      a.isActive === a.active ? 0 : b.active ? -1 : 1,
    );
  };

  const shortenTickets = (tickets) => {
    const shortenedTickets = tickets.map((ticket) => ({
      _id: ticket._id,
      num: ticket.num,
      title: ticket.title,
      company: ticket.company,
      applicant: ticket.applicant,
      responsibles: ticket.responsibles,
      state: ticket.state,
      createdAt: ticket.createdAt,
      deadline: ticket.deadline,
    }));

    return shortenedTickets;
  };

  try {
    let data = { dashboardPrefs: {} };
    let tasks = [];

    const authedUser = await User.findById(userId);

    const {
      globalActions,
      globalTasks,
      globalStats,
      personalActions,
      personalTasks,
      personalStats,
    } = authedUser.dashboard;

    // adding global actions to response
    if (globalActions) {
      //
    }

    // adding global tasks to response
    if (globalTasks) {
      const newTickets = await Ticket.find({ state: "Новая" });

      const deadlineIsTodayTickets = await Ticket.find({
        $and: [
          {
            deadline: { $gte: startOfDay, $lte: endOfDay },
          },
          { isClosed: false },
        ],
      });
      const overdueTickets = await Ticket.find({
        $and: [
          {
            $where: function () {
              return this.deadline < new Date();
            },
          },
          { isClosed: false },
        ],
      });

      tasks.push(
        {
          desc: "Обработайте новые заявки",
          list: {
            title: "Новые заявки",
            items: shortenTickets(newTickets),
          },
          active: newTickets.length > 0,
        },
        {
          desc: "Разберитесь в причинах и обновите дедлайны для просроченных заявок",
          list: {
            title: "Все просроченные заявки",
            items: shortenTickets(overdueTickets),
          },
          active: overdueTickets.length > 0,
          priority: "danger",
        },
        {
          desc: "Проконтролируйте выполнение заявок с дедлайном на сегодня",
          list: {
            title: "Все заявки на сегодня",
            items: shortenTickets(deadlineIsTodayTickets),
          },
          active: deadlineIsTodayTickets.length > 0,
        },
      );

      data.tasks = sortByIsActive(tasks);
    }

    // adding global stats to response
    if (globalStats) {
      const companies = await Company.find();
      const specialists = await User.find({
        "permissions.canPerformTickets": true,
      });

      let clientsWorksReport = [];
      let specsWorksReport = [];

      for (let company of companies) {
        const works = await Work.find({
          company: company._id,
          finishedAt: { $gte: startOfMonth, $lte: endOfMonth },
        });

        clientsWorksReport.push({
          company: company.alias,
          totalTime: totalTime(works),
        });
      }

      for (let user of specialists) {
        const works = await Work.find({
          "finishedBy._id": user._id,
          finishedAt: { $gte: startOfMonth, $lte: endOfMonth },
        });

        specsWorksReport.push({
          specialist: `${user.lastName} ${user.firstName}`,
          totalTime: totalTime(works),
        });
      }

      data.clientsWorksReport = sortByTotalTime(clientsWorksReport);
      data.specsWorksReport = sortByTotalTime(specsWorksReport);
    }

    // adding personal actions to response
    if (personalActions) {
      //
    }

    // adding personal tasks to repsonse
    if (personalTasks) {
      const myDeadlineIsTodayTickets = await Ticket.find({
        $and: [
          {
            deadline: { $gte: startOfDay, $lte: endOfDay },
          },
          { "responsibles._id": userId },
          { isClosed: false },
        ],
      });
      const myOverdueTickets = await Ticket.find({
        $and: [
          {
            $where: function () {
              return this.deadline < new Date();
            },
          },
          { "responsibles._id": userId },
          { isClosed: false },
        ],
      });

      tasks.push(
        {
          desc: "У Вас есть заявки с нарушенным дедлайном. Закройте их или задайте новые сроки выполнения, указав причину",
          list: {
            title: "Мои просроченные заявки",
            items: shortenTickets(myOverdueTickets),
          },
          active: myOverdueTickets.length > 0,
          priority: "danger",
        },
        {
          desc: "У Вас есть заявки дедлайном на сегодня",
          list: {
            title: "Мои заявки на сегодня",
            items: shortenTickets(myDeadlineIsTodayTickets),
          },
          active: myDeadlineIsTodayTickets.length > 0,
        },
      );

      data.tasks = sortByIsActive(tasks);
    }

    let myWorks = {};

    if (personalStats) {
      const works = await Work.find({
        "finishedBy._id": userId,
        finishedAt: { $gte: startOfMonth, $lte: endOfMonth },
      });

      let worksData = [];

      for (let work of works) {
        const ticket = await Ticket.findById(work.ticketId);
        const ticketNum = ticket?.num;

        worksData.push({
          _id: work._id,
          ticketNum: work.ticket ? work.ticket : ticketNum,
          ticketApplicant: `${ticket?.applicant.lastName} ${ticket?.applicant.firstName}`,
          ticketCategory: ticket?.category.title,
          description: work.description,
          finishedBy: `${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`,
          startedAt: work.startedAt,
          finishedAt: work.finishedAt,
        });
      }

      myWorks = {
        list: worksData,
        totalTime: totalTime(works),
      };

      const finishedTickets = await Ticket.find({
        $and: [
          { finishedBy: userId },
          { finishedAt: { $gte: startOfMonth, $lte: endOfMonth } },
          { isClosed: true },
        ],
      });

      data.myWorks = myWorks;
      data.myFinishedTickets = shortenTickets(finishedTickets);
    }

    res.status(200).json(data);
  } catch (error) {
    next(new AppError(`Failed to fetch dashboard data`, 500, true, error));
  }
};

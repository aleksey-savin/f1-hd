const cron = require("node-cron");

const RoutineTask = require("../models/routineTask");
const { Ticket } = require("../models/ticket");
const Prefs = require("../models/preferences");

const logger = require("../utils/logger");

exports.checkRoutineTasks = async () => {
  try {
    const prefs = await Prefs.findOne({});
    const tasks = await RoutineTask.find({ isActive: true });

    tasks.forEach((task) => {
      const isValid = cron.validate(task.cronSchedule);

      if (!isValid) {
        logger.log(
          "warn",
          `Error while validating task: ${task.company.alias}, ${task.title}`,
        );
        return;
      }

      cron.schedule(
        task.cronSchedule,
        async () => {
          const now = new Date();
          const ticket = new Ticket({
            title: task.title,
            description: task.description,
            deadline: now.setTime(
              now.getTime() + prefs.deadline * 60 * 60 * 1000,
            ),
            isClosed: false,
            applicantId: task.applicant?._id,
            company: task.company,
            categoryId: task.category?._id,
            checklist: task.checklist?.map((item) => {
              return {
                description: item.description,
                checked: false,
                mandatory: true,
              };
            }),
            routineTask: task._id,
            state: "Новая",
            source: "Регламентное задание",
            createdBy: task.applicant,
            updatedBy: task.applicant,
            notifications: {
              lastAction: "new ticket",
              pending: true,
            },
          });

          await ticket.save();
        },
        {
          timezone: prefs.timezone,
        },
      );
    });
    return;
  } catch (error) {
    console.error("Error fetching cron expressions from the database:", error);
  }
};

exports.validateRoutineTask = async (cronSchedule) => {
  return cron.validate(cronSchedule);
};

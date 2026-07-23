const cron = require("node-cron");

const RoutineTask = require("../models/routineTask");
const { Ticket } = require("../models/ticket");
const Prefs = require("../models/preferences");
const Company = require("../models/company");

const taskManager = require("./taskManager");
const logger = require("../utils/logger");

// Единая точка создания заявки регламентом. И планировщик, и ручной запуск зовут
// её по id — данные всегда свежие из БД (чек-лист, ответственные, пропуск), без
// in-memory замыканий на устаревший объект задачи.
//   options.force — создать немедленно (ручной «создать заявку сейчас»),
//   игнорируя isActive и флаг пропуска.
const runRoutineTask = async (taskId, options = {}) => {
  const { force = false } = options;
  try {
    const task = await RoutineTask.findById(taskId);
    if (!task) return null;

    if (!force && !task.isActive) return null;

    // Плановое срабатывание после ручного запуска — пропускаем один раз.
    if (!force && task.skipNextRun) {
      task.skipNextRun = false;
      await task.save();
      logger.log("info", `Routine ${taskId}: ближайший плановый запуск пропущен`);
      return null;
    }

    // Компания регламента отключена — плановые запуски пропускаем (force —
    // осознанный ручной запуск оператора, выполняется). Включение компании
    // возобновляет расписание без правок регламента.
    if (!force && task.company?._id) {
      const taskCompany = await Company.findById(task.company._id).select(
        "isActive",
      );
      if (taskCompany && taskCompany.isActive === false) {
        logger.log(
          "info",
          `Routine ${taskId}: компания «${task.company.alias}» отключена — плановый запуск пропущен`,
        );
        return null;
      }
    }

    const prefs = await Prefs.findOne({});
    const now = new Date();
    const responsibles = task.responsibles || [];

    const ticket = new Ticket({
      title: task.title,
      description: task.description,
      isClosed: false,
      applicantId: task.applicant?._id,
      company: task.company,
      categoryId: task.category?._id,
      responsibles,
      deadline: now.setTime(now.getTime() + prefs.deadline * 60 * 60 * 1000),
      // С назначенными ответственными заявка сразу «Не в работе» (как в ручной форме).
      state: responsibles.length ? "Не в работе" : "Новая",
      source: "Регламентное задание",
      routineTask: task._id,
      checklist: task.checklist?.map((item) => ({
        description: item.description,
        checked: false,
        mandatory: !!item.mandatory,
      })),
      createdBy: task.applicant,
      updatedBy: task.applicant,
      notifications: {
        lastAction: "new ticket",
        pending: true,
      },
    });

    await ticket.save();
    return ticket;
  } catch (error) {
    logger.log("error", `Failed to run routine task ${taskId}`, {
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
};

// Регистрация одной задачи в планировщике (через taskManager — единый Map, чтобы
// правка/удаление находили задачу и не плодили дублей). Callback читает БД по id.
const scheduleRoutineTask = async (task) => {
  if (!cron.validate(task.cronSchedule)) {
    logger.log(
      "warn",
      `Некорректное расписание регламента ${task._id}: ${task.cronSchedule}`,
    );
    return;
  }
  const id = task._id.toString();
  await taskManager.updateTask(id, task.cronSchedule, () => runRoutineTask(id));
};

exports.runRoutineTask = runRoutineTask;
exports.scheduleRoutineTask = scheduleRoutineTask;

// Регистрация всех активных регламентов при старте приложения.
exports.checkRoutineTasks = async () => {
  try {
    const tasks = await RoutineTask.find({ isActive: true });
    for (const task of tasks) {
      await scheduleRoutineTask(task);
    }
    logger.log("info", `Зарегистрировано регламентов: ${tasks.length}`);
  } catch (error) {
    logger.log("error", "Ошибка регистрации регламентов при старте", {
      error: error.message,
    });
  }
};

exports.validateRoutineTask = async (cronSchedule) => cron.validate(cronSchedule);

const RoutineTask = require("../models/routineTask");
const { AppError } = require("../middleware/errorHandling");
const cronScheduler = require("../middleware/cronTasks");
const {
  validateRoutineTask,
  runRoutineTask,
  scheduleRoutineTask,
} = require("../middleware/routineTasks");

const Company = require("../models/company");
const User = require("../models/user");
const TicketCategory = require("../models/ticketCategory");

const getAuthData = require("../middleware/getAuthData");

exports.getAll = async (req, res, next) => {
  try {
    const routineTasks = await RoutineTask.find({}).sort({ _id: -1 });
    res.status(200).json(routineTasks || []);
  } catch (error) {
    next(new AppError(`Failed to fetch routine tasks`, 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const routineTask = await RoutineTask.findById(req.params.id)
      .populate("createdBy", "_id firstName lastName")
      .populate("updatedBy", "_id firstName lastName");
    if (!routineTask) {
      return res.status(404).json({
        error: 404,
        message: "Регламентное задание не найдено",
      });
    }
    res.status(200).json(routineTask);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch routine task ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Единообразно собираем данные задания из тела запроса (add + update): компания/
// инициатор/категория — по id, ответственные и чек-лист чистим, ссылку на
// шаблон-источник сохраняем снимком.
const buildRoutineData = async (body) => {
  const {
    title,
    description,
    cronSchedule,
    isActive,
    checklist,
    companyId,
    applicantId,
    categoryId,
    responsibles,
    sourceTemplate,
  } = body;

  const company = await Company.findById(companyId);
  const applicant = await User.findById(applicantId);
  const category = await TicketCategory.findById(categoryId);

  return {
    title,
    description,
    cronSchedule,
    isActive: !!isActive,
    company,
    applicant,
    category,
    responsibles: Array.isArray(responsibles)
      ? responsibles.map((r) => ({
          _id: r._id,
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          phone: r.phone,
          position: r.position,
          role: r.role,
          isActive: r.isActive,
        }))
      : [],
    sourceTemplate:
      sourceTemplate && sourceTemplate._id
        ? { _id: sourceTemplate._id, title: sourceTemplate.title }
        : null,
    checklist: Array.isArray(checklist)
      ? checklist
          .filter((item) => item && item.description && item.description.trim())
          .map((item) => ({
            description: item.description,
            mandatory: !!item.mandatory,
            checked: false,
          }))
      : [],
  };
};

exports.add = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    if (!(await validateRoutineTask(req.body.cronSchedule))) {
      return res.status(400).json({
        error: 400,
        message: 'Ошибка в значении "Расписание cron".',
      });
    }

    const data = await buildRoutineData(req.body);
    const routineTask = new RoutineTask({
      ...data,
      createdBy: authedUser,
      updatedBy: authedUser,
    });

    await routineTask.save();

    if (routineTask.isActive) {
      await scheduleRoutineTask(routineTask);
    }

    res.status(201).json({
      message: "Новое регламентное задание успешно добавлено",
      routineTask,
    });
  } catch (error) {
    next(new AppError(`Failed to create routine task`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);

    if (!(await validateRoutineTask(req.body.cronSchedule))) {
      return res.status(400).json({
        error: 400,
        message: 'Ошибка в значении "Расписание cron".',
      });
    }

    const routineTask = await RoutineTask.findById(req.params.id);
    if (!routineTask) {
      return res.status(404).json({
        error: 404,
        message: "Регламентное задание не найдено",
      });
    }

    const data = await buildRoutineData(req.body);
    Object.assign(routineTask, data);
    routineTask.updatedBy = userId;

    await routineTask.save();

    if (routineTask.isActive) {
      await scheduleRoutineTask(routineTask);
    } else {
      cronScheduler.removeCronTask(req.params.id);
    }

    res.status(201).json({
      message: "Регламентное задание обновлено",
      routineTask,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update routine task ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Правка только чек-листа с карточки. Планировщик перерегистрировать НЕ нужно:
// runRoutineTask читает свежую задачу из БД при каждом срабатывании.
exports.updateChecklist = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);

    const routineTask = await RoutineTask.findById(req.params.id);
    if (!routineTask) {
      return res.status(404).json({
        error: 404,
        message: "Регламентное задание не найдено",
      });
    }

    const checklist = Array.isArray(req.body.checklist)
      ? req.body.checklist
      : [];
    routineTask.checklist = checklist
      .filter((item) => item && item.description && item.description.trim())
      .map((item) => ({
        description: item.description,
        mandatory: !!item.mandatory,
        checked: false,
      }));
    routineTask.updatedBy = userId;

    await routineTask.save();

    res.status(201).json(routineTask);
  } catch (error) {
    next(
      new AppError(
        `Failed to update routine task checklist`,
        500,
        true,
        error,
      ),
    );
  }
};

// Ручной запуск: немедленно создаёт заявку из полей регламента. Опция skipNext —
// пропустить одно ближайшее плановое срабатывание, чтобы не задвоить заявку.
exports.run = async (req, res, next) => {
  try {
    const routineTask = await RoutineTask.findById(req.params.id);
    if (!routineTask) {
      return res.status(404).json({
        error: 404,
        message: "Регламентное задание не найдено",
      });
    }

    const ticket = await runRoutineTask(req.params.id, { force: true });
    if (!ticket) {
      return res.status(500).json({
        error: 500,
        message: "Не удалось создать заявку",
      });
    }

    if (req.body.skipNext) {
      routineTask.skipNextRun = true;
      await routineTask.save();
    }

    res.status(201).json({
      message: "Заявка создана",
      ticketNum: ticket.num,
      skipNext: !!req.body.skipNext,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to run routine task ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const routineTask = await RoutineTask.findById(req.params.id);
    if (routineTask) {
      await RoutineTask.deleteOne({ _id: req.params.id });

      cronScheduler.removeCronTask(req.params.id);
      res.status(201).json({
        message: "Регламентное задание удалено",
      });
    } else {
      return res.status(404).json({
        error: 404,
        message: "Регламентное задание не найдено",
      });
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete routine task ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

const RoutineTask = require("../models/routineTask");
const { AppError } = require("../middleware/errorHandling");
const cronScheduler = require("../middleware/cronTasks");
const { validateRoutineTask } = require("../middleware/routineTasks");

const Company = require("../models/company");
const User = require("../models/user");
const { Ticket } = require("../models/ticket");
const TicketCategory = require("../models/ticketCategory");
const Preferences = require("../models/preferences");

const getAuthData = require("../middleware/getAuthData");

exports.getAll = async (req, res, next) => {
  try {
    const routineTasks = await RoutineTask.find({}).sort({ _id: -1 });
    if (!routineTasks) {
      return res.status(404).json({
        error: 404,
        message: "Регламентные задания не найдены",
      });
    }

    res.status(200).json(routineTasks);
  } catch (error) {
    next(new AppError(`Failed to fetch routine tasks`, 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const routineTask = await RoutineTask.findById(req.params.id);
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

exports.add = async (req, res, next) => {
  const authedUser = await getAuthData(req);
  const {
    title,
    description,
    cronSchedule,
    isActive,
    checklist,
    companyId,
    applicantId,
    categoryId,
  } = req.body;

  const isValid = await validateRoutineTask(cronSchedule);

  if (!isValid) {
    return res.status(400).json({
      error: 400,
      message: 'Ошибка в значении "Расписание cron".',
    });
  }

  const prefs = await Preferences.findOne({});

  const company = await Company.findById(companyId);
  const applicant = await User.findById(applicantId);
  const category = await TicketCategory.findById(categoryId);

  let checklistItems = [];
  if (checklist) {
    checklistItems = checklist.map((item) => ({
      description: item,
      checked: false,
    }));
  }

  try {
    const routineTask = new RoutineTask({
      title: title,
      description: description,
      company: company,
      applicant: applicant,
      category: category,
      cronSchedule: cronSchedule,
      isActive: isActive,
      checklist: checklistItems,
      createdBy: authedUser,
      updatedBy: authedUser,
    });

    await routineTask.save();

    if (routineTask.isActive) {
      cronScheduler.addCronTask(
        routineTask._id.toString(),
        routineTask.cronSchedule,
        async () => {
          const now = new Date();
          const ticket = new Ticket({
            title: routineTask.title,
            description: routineTask.description,
            isClosed: false,
            deadline: now.setTime(
              now.getTime() + prefs.deadline * 60 * 60 * 1000,
            ),
            applicantId: routineTask.applicant._id,
            company: routineTask.company,
            categoryId: routineTask.category._id,
            state: "Новая",
            source: "Регламентное задание",
            routineTask: routineTask._id,
            checklist: routineTask.checklist?.map((item) => ({
              description: item.description,
              checked: false,
              mandatory: true,
            })),
            createdBy: routineTask.applicant,
            updatedBy: routineTask.applicant,
            notifications: {
              lastAction: "new ticket",
              pending: true,
            },
          });

          await ticket.save();
        },
      );
    }

    res.status(201).json({
      message: "Новое регламентное задание успешно добавлено",
      routineTask: routineTask,
    });
  } catch (error) {
    next(new AppError(`Failed to create routine task`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);

    const {
      title,
      description,
      cronSchedule,
      isActive,
      checklist,
      companyId,
      applicantId,
      categoryId,
    } = req.body;

    const isValid = await validateRoutineTask(cronSchedule);

    if (!isValid) {
      return next(new AppError(`Ошибка в значении "Расписание cron".`, 500));
    }

    const prefs = await Preferences.findOne({});

    const company = await Company.findById(companyId);
    const applicant = await User.findById(applicantId);
    const authedUser = await User.findById(userId);
    const category = await TicketCategory.findById(categoryId);

    const routineTask = await RoutineTask.findById(req.params.id);

    let checklistItems = [];
    if (checklist) {
      checklistItems = checklist.map((item) => ({
        description: item,
        checked: false,
      }));
    }

    routineTask.title = title;
    routineTask.description = description;
    routineTask.company = company;
    routineTask.applicant = applicant;
    routineTask.category = category;
    routineTask.cronSchedule = cronSchedule;
    routineTask.isActive = isActive;
    routineTask.checklist = checklistItems;
    routineTask.updatedBy = authedUser;

    await routineTask.save();

    if (routineTask.isActive) {
      cronScheduler.updateCronTask(
        routineTask._id.toString(),
        routineTask.cronSchedule,
        async () => {
          const now = new Date();
          const ticket = new Ticket({
            title: routineTask.title,
            description: routineTask.description,
            isClosed: false,
            applicantId: routineTask.applicant._id,
            company: routineTask.company,
            categoryId: routineTask.category._id,
            deadline: now.setTime(
              now.getTime() + prefs.deadline * 60 * 60 * 1000,
            ),
            state: "Новая",
            source: "Регламентное задание",
            routineTask: routineTask._id,
            checklist: routineTask.checklist?.map((item) => {
              return {
                description: item.description,
                checked: false,
                mandatory: true,
              };
            }),
            createdBy: routineTask.applicant,
            updatedBy: routineTask.applicant,
            notifications: {
              lastAction: "new ticket",
              pending: true,
            },
          });

          await ticket.save();
        },
      );
    } else {
      cronScheduler.removeCronTask(req.params.id);
    }

    res.status(201).json({
      message: "Регламентное задание обновлено",
      routineTask: routineTask,
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

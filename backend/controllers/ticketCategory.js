const TicketCategory = require("../models/ticketCategory");
const ServicePlan = require("../models/finances/servicePlan");
const User = require("../models/user");
const { AppError } = require("../middleware/errorHandling");
const { concatIdsArray } = require("../helpers/concatIdsArray");
const getAuthData = require("../middleware/getAuthData");

exports.getAll = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);
    const categories = await TicketCategory.find({}).sort({ title: 1 });

    const filteredCategories = categories.filter((category) => {
      if (
        authedUser.categories
          .map((category) => category._id.toString())
          .includes(category._id.toString()) ||
        authedUser.permissions.canAdministrateTickets ||
        authedUser.isAdmin
      ) {
        return category;
      }
    });

    res.status(200).json(filteredCategories);
  } catch (error) {
    next(new AppError(`Failed to fetch ticket categories`, 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const category = await TicketCategory.findById(req.params.id);
    if (!category) {
      return next(
        new AppError(
          `Couldn't find ticket category with id ${req.params.id}`,
          404,
        ),
      );
    }

    res.status(200).json(category);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch ticket category ${req.params.id}`,
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
      title = "",
      description = "",
      isActive = false,
      alwaysWithinPlan = false,
      servicePlans,
      users,
    } = req.body;

    const categoryExists = await TicketCategory.findOne({
      title: req.body.title,
    });

    if (categoryExists) {
      return next(
        new AppError(`Категория с таким наименованием уже существует.`, 409),
      );
    }

    let usersList = [];
    for (let userId of users) {
      let user = null;
      if (userId) {
        user = await User.findById(userId);
      }

      if (user) {
        usersList.push(user);
      }
    }

    let servicePlansList = [];
    for (let planId of servicePlans) {
      let plan = null;
      if (planId) {
        plan = await ServicePlan.findById(planId);
      }
      if (plan) {
        servicePlansList.push(plan);
      }
    }

    const category = new TicketCategory({
      title: title,
      description: description,
      isActive: isActive,
      alwaysWithinPlan: alwaysWithinPlan,
      users: usersList,
      servicePlans: servicePlansList,
    });

    await category.save();

    for (let user of category.users) {
      const updatedUser = await User.findById(user._id);
      if (updatedUser) {
        updatedUser.categories.push(category);
        await updatedUser.save();
      }
    }

    for (let plan of category.servicePlans) {
      const updatedPlan = await ServicePlan.findById(plan._id);
      if (updatedPlan) {
        updatedPlan.ticketCategories.push(category);
        await updatedPlan.save();
      }
    }

    res.status(201).json({
      message: "Новая категория успешно добавлена",
      category: category,
    });
  } catch (error) {
    next(
      new AppError(`Failed to create new ticket category`, 500, true, error),
    );
  }
};

exports.update = async (req, res, next) => {
  try {
    const category = await TicketCategory.findById(req.params.id);

    const {
      title = "",
      description = "",
      isActive = false,
      alwaysWithinPlan = false,
      users,
      servicePlans,
    } = req.body;

    let usersList = [];
    const usersArray = concatIdsArray(users, category.users);
    for (let userId of usersArray) {
      const updatedUser = await User.findById(userId);
      if (updatedUser) {
        let filteredCategories = updatedUser.categories.filter(
          (userCategory) =>
            userCategory._id.toString() !== category._id.toString(),
        );

        if (users.includes(updatedUser._id.toString())) {
          usersList.push(updatedUser);
          filteredCategories.push(category);
        }
        updatedUser.categories = filteredCategories;
        await updatedUser.save();
      }
    }

    let servicePlansList = [];
    const plansArray = concatIdsArray(servicePlans, category.servicePlans);
    for (let planId of plansArray) {
      const updatedPlan = await ServicePlan.findById(planId);
      if (updatedPlan) {
        let filteredCategories = updatedPlan.ticketCategories.filter(
          (planCategory) =>
            planCategory._id.toString() !== category._id.toString(),
        );

        if (servicePlans.includes(updatedPlan._id.toString())) {
          servicePlansList.push(updatedPlan);
          filteredCategories.push(category);
        }
        updatedPlan.ticketCategories = filteredCategories;
        await updatedPlan.save();
      }
    }

    category.title = title;
    category.description = description;
    category.isActive = isActive;
    category.alwaysWithinPlan = alwaysWithinPlan;
    category.users = usersList;
    category.servicePlans = servicePlansList;
    await category.save();

    res.status(201).json({
      message: "Категория успешно изменена.",
      category: category,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update ticket category ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const category = await TicketCategory.findById(req.params.id);
    if (category) {
      for (let user of category.users) {
        const updatedUser = await User.findById(user._id);
        if (updatedUser) {
          const filteredCategories = updatedUser.categories.filter(
            (userCategory) =>
              userCategory._id.toString() !== category._id.toString(),
          );

          updatedUser.categories = filteredCategories;

          await updatedUser.save();
        }
      }

      for (let plan of category.servicePlans) {
        const updatedPlan = await ServicePlan.findById(plan._id);
        if (updatedPlan) {
          const filteredCategories = updatedPlan.ticketCategories.filter(
            (planCategory) =>
              planCategory._id.toString() !== category._id.toString(),
          );

          updatedPlan.ticketCategories = filteredCategories;

          await updatedPlan.save();
        }
      }

      await TicketCategory.deleteOne({ _id: req.params.id });
      res.status(201).json({
        message: "Категория удалена.",
      });
    } else {
      next(new AppError(`Ticket category not found`, 404));
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete ticket category ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

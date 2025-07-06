const TicketTemplate = require("../models/ticketTemplate");
const User = require("../models/user");
const Company = require("../models/company");
const TicketCategory = require("../models/ticketCategory");

const getAuthData = require("../middleware/getAuthData");

const { AppError } = require("../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const { _id: userId, company, permissions } = await getAuthData(req);
    const authedUser = await User.findById(userId);

    let templates = [];

    if (permissions.canManageTicketTemplates) {
      templates = await TicketTemplate.find({}).sort({
        title: 1,
      });

      return res.status(200).json(templates);
    }

    templates = await TicketTemplate.find({
      $or: [
        { "createdBy._id": userId },
        { sharedCompanies: company },
        { sharedUsers: authedUser },
      ],
    }).sort({
      title: 1,
    });

    res.status(200).json(templates);
  } catch (error) {
    next(new AppError(`Failed to fetch ticket templates`, 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const template = await TicketTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }
    res.status(200).json(template);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch ticket template ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  const { userId, isEndUser, company = {} } = await getAuthData(req);
  const authedUser = await User.findById(userId);

  console.log(req.body);

  try {
    const template = new TicketTemplate({
      ...req.body,
      company: isEndUser ? company : req.body.company,
      sharedCompanies: req.body.sharedCompanies || [],
      sharedUsers: req.body.sharedUsers || [],
      createdBy: authedUser,
      updatedBy: authedUser,
    });

    template.save();
    res.status(201).json(template);
  } catch (error) {
    next(new AppError(`Failed to add ticket template`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  const {
    userId,
    isEndUser,
    company: authedUserCompany,
  } = await getAuthData(req);
  const authedUser = await User.findById(userId);

  const {
    title,
    description,
    category: categoryId,
    company: companyId,
    customFields,
    sharedCompanies: sharedCompaniesIds,
    sharedUsers: sharedUsersIds,
  } = req.body;

  try {
    const template = await TicketTemplate.findById(req.params.id);

    let company;
    let category;

    if (companyId) {
      company = await Company.findById(companyId);
    }

    if (categoryId) {
      category = await TicketCategory.findById(categoryId);
    }

    let sharedCompanies = [];
    let sharedUsers = [];

    for (let id of sharedCompaniesIds) {
      const company = await Company.findById(id);
      if (company) {
        sharedCompanies.push(company);
      }
    }

    for (let id of sharedUsersIds) {
      const user = await User.findById(id);
      if (user) {
        sharedUsers.push(user);
      }
    }

    template.title = title;
    template.description = description;
    template.category = category;
    template.company = (isEndUser ? authedUserCompany : company) || {};
    template.customFields = customFields;
    template.sharedCompanies = isEndUser ? authedUserCompany : sharedCompanies;
    template.sharedUsers = sharedUsers;
    template.updatedBy = authedUser;

    template.save();
    res.status(201).json(template);
  } catch (error) {
    next(new AppError(`Failed to update ticket template`, 500, true, error));
  }
};

exports.delete = async (req, res, next) => {
  try {
    await TicketTemplate.deleteOne({ _id: req.params.id });

    res.status(201).json({
      message: "Ticket deleted successfully!",
    });
  } catch (error) {
    next(new AppError(`Failed to delete ticket template`, 500, true, error));
  }
};

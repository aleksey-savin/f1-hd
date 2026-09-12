const Company = require("../models//company");
const User = require("../models//user");
const TicketCategory = require("../models//ticketCategory");


const { AppError } = require("../middleware/errorHandling");

exports.getCompanies = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;

    const companies = authedUser.isEndUser
      ? authedUser.company?._id
        ? await Company.find({ _id: authedUser.company._id }).sort({ alias: 1 })
        : [] // клиент без компании не видит ни одной — иначе undefined в фильтре означал бы «все»
      : await Company.find({}).sort({ alias: 1 });

    const shortenedCompaniesList = companies.map((company) => ({
      _id: company._id,
      alias: company.alias,
      fullTitle: company.fullTitle,
    }));

    res.status(200).json(shortenedCompaniesList);
  } catch (error) {
    next(new AppError(`Failed to fetch companies for form`, 500, true, error));
  }
};

exports.getServiceAccounts = async (req, res, next) => {
  try {
    const users = await User.find({
      isServiceAccount: true,
      banned: { $ne: true },
    });
    const shortenedUsersList = users.map((user) => ({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
    }));
    res.status(200).json(shortenedUsersList);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch service accounts for form`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const categories = await TicketCategory.find({ isActive: true });

    const shortenedCategories = categories.map((category) => ({
      _id: category._id,
      title: category.title,
    }));
    res.status(200).json(shortenedCategories);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch ticket categories for form`,
        500,
        true,
        error,
      ),
    );
  }
};

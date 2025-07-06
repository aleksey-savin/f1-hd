const Preferences = require("../models/preferences");
const User = require("../models/user");
const { Ticket } = require("../models/ticket");
const Company = require("../models/company");
const Comment = require("../models/comment");

const { AppError } = require("../middleware/errorHandling");

exports.get = async (req, res, next) => {
  try {
    const preferences = await Preferences.findOne({});
    if (!preferences) {
      return res.status(200).json({ message: "Preferences are not set" });
    }
    res.status(200).json(preferences);
  } catch (error) {
    next(new AppError(`Failed to fetch preferences`, 500, true, error));
  }
};

exports.getAuth = async (req, res, next) => {
  try {
    const usersCount = await User.countDocuments();

    if (usersCount === 0) {
      return res.status(200).json({
        firstLaunch: true,
      });
    }

    const preferences = await Preferences.findOne({});

    return res.status(200).json({
      pro32connect: preferences?.getScreen || false,
      emailIsActive: preferences?.notify?.byEmail?.isActive || false,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch preferences for auth page`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.getInitial = async (req, res, next) => {
  try {
    const preferences = await Preferences.findOne({});

    if (!preferences) {
      return res.status(200).json({ message: "Preferences are not set" });
    }

    res.status(200).json({
      contacts: preferences.contacts,
      htmlTicketDesc: preferences.htmlTicketDesc,
      getScreen: preferences.getScreen,
      timezone: preferences.timezone,
      emailNotifications: preferences.notify?.byEmail?.isActive,
      telegramNotifications: preferences.notify?.byTelegram?.isActive,
      personalNotifications: preferences.notify.personal,
      modules: preferences.modules,
    });
  } catch (error) {
    next(new AppError(`Failed to fetch initial preferences`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    let preferences = await Preferences.findOne({});

    const {
      timezone,
      htmlTicketDesc,
      useEmail,
      emailAddress,
      emailPassword,
      imapServer,
      defaultApplicant,
      defaultCompany,
      identifyCompany,
      identifyApplicant,
      checkPhoneNumber,
      deadline,
      notify,
      contacts,
      getScreen,
      modules,
    } = req.body;

    if (!preferences) {
      preferences = new Preferences({
        timezone,
        htmlTicketDesc,
        useEmail,
        emailAddress,
        emailPassword,
        imapServer,
        defaultApplicant,
        defaultCompany,
        identifyCompany,
        identifyApplicant,
        checkPhoneNumber,
        deadline,
        notify,
        contacts,
        getScreen,
        modules,
      });
    } else {
      preferences.timezone = timezone;
      preferences.htmlTicketDesc = htmlTicketDesc;
      preferences.useEmail = useEmail;
      preferences.emailAddress = emailAddress;
      preferences.emailPassword = emailPassword;
      preferences.imapServer = imapServer;
      preferences.defaultApplicant = defaultApplicant;
      preferences.defaultCompany = defaultCompany;
      preferences.identifyCompany = identifyCompany;
      preferences.identifyApplicant = identifyApplicant;
      preferences.checkPhoneNumber = checkPhoneNumber;
      preferences.deadline = deadline;
      preferences.notify = notify;
      preferences.contacts = contacts;
      preferences.getScreen = getScreen;
      preferences.modules = {
        timeTracking: {
          isActive: modules.timeTracking.isActive,
        },
        finances: {
          isActive: modules.timeTracking.isActive
            ? modules.finances.isActive
            : false,
        },
        inventory: {
          isActive: modules.inventory.isActive,
        },
      };
    }

    await preferences.save();
    res.status(200).json({
      message: "Preferences updated successfully!",
      preferences: preferences,
    });
  } catch (error) {
    next(new AppError(`Failed to update preferences`, 500, true, error));
  }
};

exports.updateDbConf = async (req, res, next) => {
  try {
    const companies = await Company.find();
    const tickets = await Ticket.find();
    const comments = await Comment.find();

    for (let company of companies) {
      if (company.employees.length === 0 || !company.employees) {
        company.employees = company.users.map((user) => user._id);
        await company.save();
      }
    }

    for (let ticket of tickets) {
      if (!ticket.applicantId) {
        ticket.applicantId = ticket.applicant._id;
      }

      if (!ticket.categoryId) {
        ticket.categoryId = ticket.category._id;
      }

      await ticket.save();
    }

    for (let comment of comments) {
      if (!comment.ticketId) {
        const ticket = await Ticket.findOne({ num: comment.ticket });

        if (ticket) {
          comment.ticketId = ticket._id;
          await comment.save();

          ticket.comments
            ? ticket.comments.push(comment._id)
            : (ticket.comments = [comment._id]);
          await ticket.save();
        }
      }
    }

    res.status(200).json({
      message: "Конфигурация базы данных успешно обновлена",
    });
  } catch (error) {
    next(new AppError(`Failed to update db configuration`, 500, true, error));
  }
};

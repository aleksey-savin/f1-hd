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
      ai,
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
        ai,
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
      preferences.ai = ai;
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

exports.getAiModels = async (req, res, next) => {
  try {
    const { provider } = req.body;
    let { apiKey } = req.body;

    if (!provider || !["openai", "anthropic"].includes(provider)) {
      return next(new AppError("Unknown AI provider", 400, true));
    }

    // Fall back to the stored key if the client didn't send one.
    if (!apiKey) {
      const preferences = await Preferences.findOne({});
      apiKey = preferences?.ai?.[provider]?.apiKey;
    }

    if (!apiKey) {
      return next(new AppError("AI API key is not set", 400, true));
    }

    let models = [];

    if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        return next(
          new AppError("Failed to fetch OpenAI models", response.status, true),
        );
      }

      const data = await response.json();
      models = (data.data || [])
        .filter((model) => /^(gpt|o\d|chatgpt)/.test(model.id))
        .map((model) => ({ id: model.id, name: model.id }))
        .sort((a, b) => b.id.localeCompare(a.id));
    }

    if (provider === "anthropic") {
      const response = await fetch(
        "https://api.anthropic.com/v1/models?limit=1000",
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      );

      if (!response.ok) {
        return next(
          new AppError(
            "Failed to fetch Anthropic models",
            response.status,
            true,
          ),
        );
      }

      const data = await response.json();
      models = (data.data || []).map((model) => ({
        id: model.id,
        name: model.display_name || model.id,
      }));
    }

    res.status(200).json({ models });
  } catch (error) {
    next(new AppError(`Failed to fetch AI models`, 500, true, error));
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

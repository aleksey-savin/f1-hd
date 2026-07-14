const Preferences = require("../models/preferences");
const User = require("../models/user");
const { Ticket } = require("../models/ticket");
const Company = require("../models/company");
const Comment = require("../models/comment");
const KnowledgeNote = require("../models/knowledgeNote");

const { AppError } = require("../middleware/errorHandling");
const getAuthData = require("../middleware/getAuthData");
const { isModerator } = require("../helpers/knowledgeNoteVisibility");
const { runSecretsScan } = require("../services/secretsScanRun");
const { runServiceExpiryScan } = require("../services/serviceExpiryScanRun");
const logger = require("../utils/logger");

const isOpenaiSpeechModel = (modelId) =>
  /^(whisper-1|gpt-4o(?:-mini)?-transcribe(?:-diarize)?(?:-\d{4}-\d{2}-\d{2})?)$/.test(
    modelId,
  );

// YandexGPT не отдаёт каталог моделей по API — список фиксированный.
const YANDEX_GPT_MODELS = [
  { id: "yandexgpt", name: "YandexGPT Pro" },
  { id: "yandexgpt-lite", name: "YandexGPT Lite" },
  { id: "yandexgpt-32k", name: "YandexGPT 32k" },
];

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

    // Статус модерации базы знаний для текущего пользователя — нужен глобально
    // (карточка модерации на странице заявок и алерт об утечках на каждой странице).
    const authedUser = await getAuthData(req);
    const kb = preferences.knowledgeBase || {};
    const moderatorIds = (kb.moderators || [])
      .map((moderator) => moderator?._id?.toString())
      .filter(Boolean);
    const userIsModerator = isModerator(authedUser, moderatorIds);

    let counts = {
      pendingApproval: 0,
      pendingDeletion: 0,
      pendingArchive: 0,
      secretsFlagged: 0,
    };
    if (userIsModerator) {
      // Архивные исключаем из счётчиков, кроме секретов (утечку видно и в архиве)
      const [pendingApproval, pendingDeletion, pendingArchive, secretsFlagged] =
        await Promise.all([
          KnowledgeNote.countDocuments({
            approved: { $ne: true },
            archivedAt: null,
          }),
          KnowledgeNote.countDocuments({
            pendingDeletion: true,
            archivedAt: null,
          }),
          KnowledgeNote.countDocuments({
            pendingArchive: true,
            archivedAt: null,
          }),
          KnowledgeNote.countDocuments({ "secretsScan.flagged": true }),
        ]);
      counts = {
        pendingApproval,
        pendingDeletion,
        pendingArchive,
        secretsFlagged,
      };
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
      ai: {
        isActive: preferences.ai?.isActive || false,
        speechToText: {
          isActive: preferences.ai?.speechToText?.isActive || false,
        },
      },
      knowledgeBase: {
        isModerator: userIsModerator,
        hideNotApproved: !!kb.hideNotApproved,
        scanForSecrets: !!kb.scanForSecrets,
        // Срок действия проверки: клиент считает по нему «действует ещё N дн.»
        approvalPeriodDays: kb.approvalPeriodDays || 0,
        counts,
      },
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
      knowledgeBase,
      mikrotik,
      overtime,
      statusBoard,
    } = req.body;

    // Переход флага «выкл→вкл» — повод просканировать сразу, не дожидаясь крона.
    // Старое значение читаем до перезаписи preferences.knowledgeBase.
    let secretsJustEnabled = false;
    let serviceJustEnabled = false;

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
        knowledgeBase,
        mikrotik,
        overtime,
        statusBoard,
      });
      secretsJustEnabled = !!knowledgeBase?.scanForSecrets;
      serviceJustEnabled = !!knowledgeBase?.trackServiceExpiry;
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
        knowledgeBase: {
          isActive: modules.knowledgeBase.isActive,
        },
      };
      preferences.ai = ai;
      // Защищаемся от затирания конфигурации модерации при частичном POST
      if (knowledgeBase) {
        const prevKb = preferences.knowledgeBase || {};
        secretsJustEnabled =
          !prevKb.scanForSecrets && !!knowledgeBase.scanForSecrets;
        serviceJustEnabled =
          !prevKb.trackServiceExpiry && !!knowledgeBase.trackServiceExpiry;
        preferences.knowledgeBase = knowledgeBase;
      }
      if (mikrotik) {
        preferences.mikrotik = mikrotik;
      }
      // Табло статусов: из веба принимаем только конфигурацию; служебные поля
      // (messageId, lastText) принадлежат боту и берутся из хранимых значений.
      // Смена группы/ветки инвалидирует сообщение — бот пересоздаст табло.
      if (statusBoard) {
        const prev = preferences.statusBoard || {};
        const chatId = statusBoard.chatId || "";
        const messageThreadId = statusBoard.messageThreadId || "";
        const targetChanged =
          chatId !== (prev.chatId || "") ||
          messageThreadId !== (prev.messageThreadId || "");
        preferences.statusBoard = {
          isActive: !!statusBoard.isActive,
          chatId,
          messageThreadId,
          messageId: targetChanged ? null : (prev.messageId ?? null),
          lastText: targetChanged ? "" : prev.lastText || "",
        };
      }
      // Защищаемся от затирания настроек переработок при частичном POST
      if (overtime) {
        preferences.overtime = overtime;
      }
    }

    await preferences.save();

    // Только что включённые фичи сканируем сразу. Ошибка скана не должна
    // валить уже сохранённые настройки — логируем и продолжаем.
    try {
      if (secretsJustEnabled) {
        await runSecretsScan();
      }
      if (serviceJustEnabled) {
        await runServiceExpiryScan();
      }
    } catch (error) {
      logger.log("error", "Knowledge base scan after enabling failed", {
        error,
      });
    }

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
    const { provider, feature } = req.body;
    let { apiKey } = req.body;

    // Yandex SpeechKit не отдаёт список моделей по API — возвращаем статический.
    if (feature === "speechToText" && provider === "yandex") {
      return res.status(200).json({
        models: [{ id: "general", name: "general (Yandex SpeechKit)" }],
      });
    }

    // YandexGPT (чат) тоже без каталога по API — отдаём фиксированный набор.
    if (provider === "yandexgpt") {
      return res.status(200).json({ models: YANDEX_GPT_MODELS });
    }

    if (!provider || !["openai", "anthropic", "deepseek"].includes(provider)) {
      return next(new AppError("Unknown AI provider", 400, true));
    }

    if (feature === "speechToText" && provider !== "openai") {
      return next(
        new AppError(
          "Speech recognition is only supported by OpenAI or Yandex",
          400,
          true,
        ),
      );
    }

    // Fall back to the stored key if the client didn't send one.
    if (!apiKey) {
      const preferences = await Preferences.findOne({});
      apiKey =
        feature === "speechToText"
          ? preferences?.ai?.speechToText?.apiKey
          : preferences?.ai?.[provider]?.apiKey;
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
        .filter((model) =>
          feature === "speechToText"
            ? isOpenaiSpeechModel(model.id)
            : /^(gpt|o\d|chatgpt)/.test(model.id),
        )
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

    // DeepSeek предоставляет OpenAI-совместимый эндпоинт каталога моделей.
    if (provider === "deepseek") {
      const response = await fetch("https://api.deepseek.com/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        return next(
          new AppError(
            "Failed to fetch DeepSeek models",
            response.status,
            true,
          ),
        );
      }

      const data = await response.json();
      models = (data.data || [])
        .map((model) => ({ id: model.id, name: model.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
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

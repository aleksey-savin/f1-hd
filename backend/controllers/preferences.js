const Preferences = require("../models/preferences");
const User = require("../models/user");
const KnowledgeNote = require("../models/knowledgeNote");

const { AppError } = require("../middleware/errorHandling");
const getAuthData = require("../middleware/getAuthData");
const storage = require("../services/storage");
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
      // Оператор такси нужен каждому: действие «такси» в справочнике компаний
      taxi: { operator: preferences.taxi?.operator || "" },
      emailNotifications: preferences.notify?.byEmail?.isActive,
      telegramNotifications: preferences.notify?.byTelegram?.isActive,
      personalNotifications: preferences.notify.personal,
      modules: preferences.modules,
      // Рубильник интеграции Mikrotik — для меню («Мониторинг», «Диапазоны
      // сетей»); отсутствие поля в старых документах = включено
      mikrotik: { isActive: preferences.mikrotik?.isActive !== false },
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
    // Частичное обновление: страница настроек сохраняет ПО СЕКЦИЯМ — меняются
    // только присланные группы, отсутствие ключа в теле = «не трогать».
    // Первый запуск обрабатывается тем же путём: пустой документ получает
    // дефолты схемы, присланные группы ложатся поверх.
    const body = req.body;
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

    let preferences = await Preferences.findOne({});
    if (!preferences) {
      preferences = new Preferences({});
    }

    // Переход флага «выкл→вкл» — повод просканировать сразу, не дожидаясь крона.
    // Старое значение читаем до перезаписи preferences.knowledgeBase.
    let secretsJustEnabled = false;
    let serviceJustEnabled = false;

    // «Основные»
    if (has("timezone")) preferences.timezone = body.timezone;
    if (has("htmlTicketDesc")) preferences.htmlTicketDesc = body.htmlTicketDesc;
    if (has("deadline")) preferences.deadline = body.deadline;
    if (has("contacts")) {
      // contacts.logo управляется отдельными эндпоинтами (/preferences/logo):
      // замена объекта целиком затирала бы лого при сохранении общих настроек
      preferences.contacts = {
        tel: body.contacts?.tel ?? "",
        email: body.contacts?.email ?? "",
        address: body.contacts?.address ?? "",
        logo: preferences.contacts?.logo ?? "",
      };
    }
    if (has("taxi")) {
      preferences.taxi = { operator: body.taxi?.operator || "" };
    }

    // «Сбор заявок»
    if (has("useEmail")) preferences.useEmail = body.useEmail;
    if (has("emailAddress")) preferences.emailAddress = body.emailAddress;
    if (has("emailPassword")) preferences.emailPassword = body.emailPassword;
    if (has("imapServer")) preferences.imapServer = body.imapServer;
    if (has("defaultApplicant"))
      preferences.defaultApplicant = body.defaultApplicant;
    if (has("defaultCompany")) preferences.defaultCompany = body.defaultCompany;
    if (has("identifyCompany"))
      preferences.identifyCompany = body.identifyCompany;
    if (has("identifyApplicant"))
      preferences.identifyApplicant = body.identifyApplicant;
    if (has("checkPhoneNumber"))
      preferences.checkPhoneNumber = body.checkPhoneNumber;

    // «Уведомления»: подгруппы notify заменяются присланными, byTelegram
    // мержится по полям (канон «мерж по путям»). Группа byTelegram — единая:
    // в ней и групповые уведомления, и табло статусов; смена chatId или ветки
    // инвалидирует закреп табло — бот пересоздаст его в новом месте
    if (has("notify")) {
      const notify = body.notify || {};
      const prev = preferences.notify?.toObject?.() ?? preferences.notify ?? {};
      const mergedTelegram = notify.byTelegram
        ? { ...(prev.byTelegram || {}), ...notify.byTelegram }
        : prev.byTelegram;
      preferences.notify = {
        personal: notify.personal ?? prev.personal,
        byEmail: notify.byEmail ?? prev.byEmail,
        byTelegram: mergedTelegram,
      };
      const boardTargetChanged =
        (mergedTelegram?.chatId || "") !== (prev.byTelegram?.chatId || "") ||
        (mergedTelegram?.messageThreadId || "") !==
          (prev.byTelegram?.messageThreadId || "");
      if (boardTargetChanged) {
        preferences.statusBoard = {
          isActive: !!preferences.statusBoard?.isActive,
          messageId: null,
          lastText: "",
        };
      }
    }

    // «Интеграции»
    if (has("getScreen")) preferences.getScreen = body.getScreen;

    // «Модули»: финансы работают поверх учёта времени
    if (has("modules")) {
      const modules = body.modules || {};
      preferences.modules = {
        timeTracking: { isActive: !!modules.timeTracking?.isActive },
        finances: {
          isActive: modules.timeTracking?.isActive
            ? !!modules.finances?.isActive
            : false,
        },
        inventory: { isActive: !!modules.inventory?.isActive },
        knowledgeBase: { isActive: !!modules.knowledgeBase?.isActive },
      };
    }

    if (has("ai")) preferences.ai = body.ai;

    if (has("knowledgeBase")) {
      const prevKb = preferences.knowledgeBase || {};
      secretsJustEnabled =
        !prevKb.scanForSecrets && !!body.knowledgeBase?.scanForSecrets;
      serviceJustEnabled =
        !prevKb.trackServiceExpiry && !!body.knowledgeBase?.trackServiceExpiry;
      preferences.knowledgeBase = body.knowledgeBase;
    }

    if (has("mikrotik")) preferences.mikrotik = body.mikrotik;

    // Табло статусов: из веба приходит только isActive; служебные поля
    // (messageId, lastText) принадлежат боту и сохраняются. Группа и ветка
    // табло — notify.byTelegram (блок выше), их смена уже сбросила закреп
    if (has("statusBoard")) {
      preferences.statusBoard = {
        isActive: !!body.statusBoard?.isActive,
        messageId: preferences.statusBoard?.messageId ?? null,
        lastText: preferences.statusBoard?.lastText || "",
      };
    }

    if (has("overtime")) preferences.overtime = body.overtime;

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
      message: "Настройки сохранены",
      preferences: preferences,
    });
  } catch (error) {
    next(new AppError(`Failed to update preferences`, 500, true, error));
  }
};

// Лого компании для навбара (contacts.logo). Файл лежит локально в uploads/
// (multer diskStorage — см. middleware/imageUpload.js); при замене и удалении
// старый файл прибирается deleteObject (толерантен к local/S3).
exports.uploadLogo = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError(`File not uploaded`, 400));
    }

    const preferences = await Preferences.findOne({});

    if (preferences.contacts?.logo) {
      await storage.deleteObject(preferences.contacts.logo);
    }

    preferences.contacts.logo = req.file.filename;
    await preferences.save();

    res.status(201).json({
      message: "Лого компании обновлено",
      logo: preferences.contacts.logo,
    });
  } catch (error) {
    next(new AppError(`Failed to upload company logo`, 500, true, error));
  }
};

exports.deleteLogo = async (req, res, next) => {
  try {
    const preferences = await Preferences.findOne({});

    if (preferences.contacts?.logo) {
      await storage.deleteObject(preferences.contacts.logo);
    }

    preferences.contacts.logo = "";
    await preferences.save();

    res.status(201).json({
      message: "Лого компании удалено",
      logo: "",
    });
  } catch (error) {
    next(new AppError(`Failed to delete company logo`, 500, true, error));
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


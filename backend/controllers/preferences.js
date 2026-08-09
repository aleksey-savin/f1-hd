const Preferences = require("../models/preferences");
const User = require("../models/user");
const Company = require("../models/company");
const AiFeedback = require("../models/aiFeedback");

const { AppError } = require("../middleware/errorHandling");
const getAuthData = require("../middleware/getAuthData");
const storage = require("../services/storage");
const { isModerator } = require("../helpers/knowledgeNoteVisibility");
const {
  getModerationCounts,
  ZERO_COUNTS,
} = require("../services/knowledgeModerationCounts");
const { runSecretsScan } = require("../services/secretsScanRun");
const { runServiceExpiryScan } = require("../services/serviceExpiryScanRun");
const {
  maskSecrets,
  keepStoredSecrets,
  readStoredSecret,
} = require("../helpers/preferencesSecrets");
const { checkMailbox, sendTestEmail } = require("../services/mail/check");
const {
  checkProvider,
  buildLocalBaseUrl,
  needsApiKey,
} = require("../services/aiService");
const {
  checkSpeechToText,
  resolveSpeechConfig,
  canShareCredentials,
} = require("../services/speechToTextService");
const logger = require("../utils/logger");

// Поля почтовых каналов, которые правит форма. Мержим по путям (а не заменяем
// группу целиком): health пишут крон сбора и отправка уведомлений, форма о нём
// не знает и не должна его затирать.
const MAILBOX_FIELDS = [
  "isActive",
  "address",
  "host",
  "port",
  "security",
  "folder",
  "allowSelfSigned",
  "password",
];

const isValidPort = (value) => Number.isInteger(value) && value > 0 && value < 65536;

// Инварианты включённых каналов: молча сохранённая полупустая конфигурация —
// это канал, который «включён» и не работает, а искать причину придётся в логах.
const findMailInvariant = (preferences) => {
  const mailbox = preferences.mailbox || {};
  if (mailbox.isActive) {
    if (!(mailbox.address || "").trim()) {
      return "Укажите адрес почтового ящика — с него собираются заявки";
    }
    if (!(mailbox.host || "").trim()) {
      return "Укажите сервер IMAP — без него письма не забрать";
    }
    if (!isValidPort(mailbox.port)) {
      return "Порт IMAP должен быть числом от 1 до 65535";
    }
    if (!mailbox.password) {
      return "Укажите пароль почтового ящика";
    }
    if (!preferences.defaultApplicant?._id) {
      return "Выберите инициатора по умолчанию — иначе заявкам из писем не от кого прийти";
    }
  }

  const smtp = preferences.notify?.byEmail || {};
  if (smtp.isActive) {
    if (!(smtp.host || "").trim()) {
      return "Укажите сервер SMTP — без него уведомления не отправить";
    }
    if (!isValidPort(smtp.port)) {
      return "Порт SMTP должен быть числом от 1 до 65535";
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((smtp.sendFromEmail || "").trim())) {
      return "Укажите корректный адрес отправителя — сервер отвергнет письмо без него";
    }
    if ((smtp.authMethod || "password") !== "none") {
      if (!(smtp.user || "").trim()) {
        return "Укажите имя пользователя SMTP или выключите авторизацию";
      }
      if (!smtp.pass) {
        return "Укажите пароль SMTP или выключите авторизацию";
      }
    }
  }

  return null;
};

// Тот же принцип у каналов ИИ: у чат-провайдера и у распознавания речи свои
// ключи, и включённый канал без них — это молчание, объяснимое только логами.
const findAiInvariant = (preferences) => {
  const ai = preferences.ai || {};
  if (!ai.isActive) return null;

  const provider = ai.provider;
  const config = (provider ? ai[provider] : null) || {};

  if (!config.apiKey && needsApiKey(provider)) {
    return "Укажите API-ключ поставщика ИИ — без него ответов не будет";
  }
  if (provider === "yandexai" && !(config.folderId || "").trim()) {
    return "Укажите идентификатор каталога — без него Yandex AI Studio не отвечает";
  }
  if (provider === "local" && !(config.baseUrl || "").trim()) {
    return "Укажите адрес сервера модели — например, http://192.168.1.10:11434";
  }
  // Каталог живой у всех четырёх поставщиков, поэтому пустая модель — это не
  // «возьмём по умолчанию», а неизбежная ошибка при первом же вызове
  if (!(config.model || "").trim()) {
    return "Выберите модель — список обновляется кнопкой рядом с полем";
  }

  // У распознавания свои данные либо взятые у основного провайдера — разбирает
  // это резолвер, инвариант проверяет уже результат
  if (ai.speechToText?.isActive) {
    const speech = resolveSpeechConfig(ai);

    if (speech.provider === "local") {
      if (!speech.baseUrl) {
        return "Укажите адрес сервера распознавания — например, http://192.168.1.10:8000";
      }
      if (!speech.model) {
        return "Выберите модель распознавания — список обновляется кнопкой рядом";
      }
    } else if (!speech.apiKey) {
      return speech.provider === "yandex"
        ? "Укажите API-ключ Yandex SpeechKit — без него аудио не расшифровать"
        : "Укажите API-ключ OpenAI для распознавания речи";
    } else if (speech.provider === "yandex" && !speech.folderId) {
      return "Укажите идентификатор каталога SpeechKit — без него запрос не примут";
    }
  }

  return null;
};

const isOpenaiSpeechModel = (modelId) =>
  /^(whisper-1|gpt-4o(?:-mini)?-transcribe(?:-diarize)?(?:-\d{4}-\d{2}-\d{2})?)$/.test(
    modelId,
  );

exports.get = async (req, res, next) => {
  try {
    const preferences = await Preferences.findOne({});
    if (!preferences) {
      return res.status(200).json({ message: "Preferences are not set" });
    }
    // Пароли и API-ключи наружу не уходят: вместо значения — флаг «задан»
    res.status(200).json(maskSecrets(preferences));
  } catch (error) {
    next(new AppError(`Failed to fetch preferences`, 500, true, error));
  }
};

/**
 * Данные для пред-авторизационных экранов: их видят до входа, поэтому ручка
 * без `isAuth` и отдаёт ровно то, что рисует оболочка, — бренд, контакты
 * поддержки (человеку, который не может войти, нужен живой канал) и два флага
 * доступности путей.
 */
exports.getAuth = async (req, res, next) => {
  try {
    // Флаги `firstLaunch` и `selfSignupIsActive` больше не отдаются: веб-форма
    // первого запуска и саморегистрация удалены. Первый администратор
    // заводится сидом при старте, остальных заводит ИТ-отдел.
    const preferences = await Preferences.findOne({});

    return res.status(200).json({
      contacts: {
        title: preferences?.contacts?.title || "",
        tel: preferences?.contacts?.tel || "",
        email: preferences?.contacts?.email || "",
        address: preferences?.contacts?.address || "",
        logo: preferences?.contacts?.logo || "",
      },
      timezone: preferences?.timezone || "",
      // без почты ссылку на смену пароля отправить нечем — путь прячется
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

    let counts = ZERO_COUNTS;
    if (userIsModerator) {
      counts = await getModerationCounts({
        scanForSecrets: !!kb.scanForSecrets,
      });
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

    // Секреты формы: пустое поле = «не менять», непустое — новый секрет
    // (шифруется). Делаем до присвоений, чтобы дальше группы клались как есть.
    for (const group of ["mailbox", "notify", "ai"]) {
      if (has(group)) keepStoredSecrets(body, preferences, group);
    }

    // Переход флага «выкл→вкл» — повод просканировать сразу, не дожидаясь крона.
    // Старое значение читаем до перезаписи preferences.knowledgeBase.
    let secretsJustEnabled = false;
    let serviceJustEnabled = false;

    /**
     * Требование второго фактора к администраторам.
     *
     * ВКЛЮЧИТЬ ЕГО МОЖЕТ ТОЛЬКО ТОТ, У КОГО ФАКТОР УЖЕ ЕСТЬ. Отсрочка спасает
     * не всегда: если за её срок никто из администраторов так и не настроил
     * приложение, требование вступает в силу и войти не может НИКТО — включая
     * тех, кто мог бы его снять. Так и вышло на стенде: оборвавшийся тест
     * оставил флаг включённым с истёкшей отсрочкой, и вход администраторам
     * закрылся полностью.
     *
     * Правило гарантирует, что хотя бы одна учётная запись с полным доступом
     * всегда пройдёт. Оно же стоит на сбросе чужого фактора — по той же
     * причине: цепочка рвётся в слабейшем звене.
     */
    if (has("twoFactorPolicy")) {
      const wanted = Boolean(body.twoFactorPolicy?.requireForAdmins);

      // Проверяем ЛЮБОЕ сохранение с включённым требованием, а не только
      // переход «выкл→вкл»: иначе администратор без фактора, попавший внутрь
      // во время отсрочки, продлевал бы её себе бесконечно.
      if (wanted) {
        const { isEnabledFor } = require("@/services/twoFactor");
        if (!(await isEnabledFor(req.auth.user._id))) {
          return next(
            new AppError(
              "Сначала включите второй фактор у себя: иначе требование закроет вход и вам тоже",
              400,
            ),
          );
        }
      }

      const grace = body.twoFactorPolicy?.graceUntil
        ? new Date(body.twoFactorPolicy.graceUntil)
        : null;
      preferences.twoFactorPolicy = {
        requireForAdmins: wanted,
        // Отсрочка живёт только вместе с требованием; выключили — обнуляем,
        // чтобы повторное включение не подхватило вчерашнюю дату.
        graceUntil: wanted ? grace : null,
      };
    }

    // «Основные»
    if (has("timezone")) preferences.timezone = body.timezone;
    if (has("htmlTicketDesc")) preferences.htmlTicketDesc = body.htmlTicketDesc;
    if (has("deadline")) preferences.deadline = body.deadline;
    if (has("contacts")) {
      // contacts.logo управляется отдельными эндпоинтами (/preferences/logo):
      // замена объекта целиком затирала бы лого при сохранении общих настроек
      preferences.contacts = {
        title: body.contacts?.title ?? "",
        tel: body.contacts?.tel ?? "",
        email: body.contacts?.email ?? "",
        address: body.contacts?.address ?? "",
        logo: preferences.contacts?.logo ?? "",
      };
    }
    if (has("taxi")) {
      preferences.taxi = { operator: body.taxi?.operator || "" };
    }
    if (has("checklistTemplates")) {
      preferences.checklistTemplates = {
        autoApply: !!body.checklistTemplates?.autoApply,
      };
    }

    // «Сбор заявок»: ящик-приёмник мержим по путям — форма не присылает health
    // (его пишут крон сбора и кнопка проверки), а замена группы целиком его бы
    // затёрла, и строка состояния обнулялась бы на каждом сохранении.
    if (has("mailbox")) {
      const incoming = body.mailbox || {};
      for (const key of MAILBOX_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(incoming, key)) {
          preferences.set(
            `mailbox.${key}`,
            key === "port" ? Number(incoming.port) : incoming[key],
          );
        }
      }
    }
    if (has("defaultApplicant"))
      preferences.defaultApplicant = body.defaultApplicant;
    if (has("defaultCompany")) preferences.defaultCompany = body.defaultCompany;
    if (has("identifyCompany"))
      preferences.identifyCompany = body.identifyCompany;
    if (has("identifyApplicant"))
      preferences.identifyApplicant = body.identifyApplicant;
    if (has("checkPhoneNumber"))
      preferences.checkPhoneNumber = body.checkPhoneNumber;

    // «Уведомления»: personal заменяется присланным, каналы мержатся по полям
    // (канон «мерж по путям»). byEmail — потому что health пишет telegram-bot
    // при реальной отправке, форма его не знает. Группа byTelegram — единая:
    // в ней и групповые уведомления, и табло статусов; смена chatId или ветки
    // инвалидирует закреп табло — бот пересоздаст его в новом месте
    if (has("notify")) {
      const notify = body.notify || {};
      const prev = preferences.notify?.toObject?.() ?? preferences.notify ?? {};
      const mergedTelegram = notify.byTelegram
        ? { ...(prev.byTelegram || {}), ...notify.byTelegram }
        : prev.byTelegram;
      const mergedEmail = notify.byEmail
        ? { ...(prev.byEmail || {}), ...notify.byEmail }
        : prev.byEmail;
      preferences.notify = {
        personal: notify.personal ?? prev.personal,
        byEmail: mergedEmail,
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

    // «ИИ»: форма присылает группу целиком (все провайдеры разом), но health
    // пишут настоящие вызовы и кнопки проверки — форма о нём не знает, и замена
    // группы обнуляла бы строки состояния на каждом сохранении секции.
    if (has("ai")) {
      const prevAi = preferences.ai?.toObject?.() ?? preferences.ai ?? {};
      const incoming = body.ai || {};
      const speechToText = incoming.speechToText
        ? { ...incoming.speechToText, health: prevAi.speechToText?.health }
        : prevAi.speechToText;

      preferences.ai = {
        ...incoming,
        ...(speechToText ? { speechToText } : {}),
        health: prevAi.health,
      };
    }

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

    // Календарь: настройки правит админ, а lastSyncAt/lastError пишет
    // загрузчик — их из тела не берём, иначе форма затрёт состояние
    if (has("productionCalendar")) {
      const incoming = body.productionCalendar;
      preferences.productionCalendar = {
        ...(preferences.productionCalendar?.toObject?.() ??
          preferences.productionCalendar ??
          {}),
        ...(incoming.isActive !== undefined
          ? { isActive: Boolean(incoming.isActive) }
          : {}),
        ...(incoming.country ? { country: String(incoming.country).toLowerCase() } : {}),
        ...(incoming.source ? { source: incoming.source } : {}),
        ...(Array.isArray(incoming.overrides)
          ? { overrides: incoming.overrides }
          : {}),
      };
    }

    // Включённый канал обязан быть настроен целиком — иначе он «работает»
    // только на вид, а причина молчания видна лишь в логах контейнера.
    const invariant = findMailInvariant(preferences) || findAiInvariant(preferences);
    if (invariant) {
      return next(new AppError(invariant, 422, true));
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
      message: "Настройки сохранены",
      // Ответ на сохранение — такой же выход наружу, как и чтение: секреты в нём
      // маскируются (иначе форма получала бы обратно шифртексты ключей)
      preferences: maskSecrets(preferences),
    });
  } catch (error) {
    next(new AppError(`Failed to update preferences`, 500, true, error));
  }
};

// Проверка почтовых каналов по значениям формы (черновик ещё не сохранён).
// Секреты форма не получает и потому не присылает: пустое поле означает
// «использовать сохранённый» — transport.readSecret понимает оба вида.
const mergeWithStored = (stored, incoming, secretKey) => ({
  ...(stored?.toObject?.() ?? stored ?? {}),
  ...(incoming || {}),
  [secretKey]: incoming?.[secretKey] || stored?.[secretKey] || "",
});

exports.checkMailbox = async (req, res, next) => {
  try {
    const preferences = await Preferences.findOne({});
    const mailbox = mergeWithStored(
      preferences?.mailbox,
      req.body?.mailbox,
      "password",
    );
    res.status(200).json(await checkMailbox(mailbox));
  } catch (error) {
    next(new AppError(`Failed to check mailbox`, 500, true, error));
  }
};

exports.sendTestEmail = async (req, res, next) => {
  try {
    const preferences = await Preferences.findOne({});
    const channel = mergeWithStored(
      preferences?.notify?.byEmail,
      req.body?.byEmail,
      "pass",
    );
    // Письмо уходит тому, кто нажал кнопку: свой ящик админ проверит сразу,
    // а вводить адрес отдельным полем — лишний шаг с шансом опечататься.
    const authedUser = await getAuthData(req);
    res.status(200).json(await sendTestEmail(channel, authedUser?.email));
  } catch (error) {
    next(new AppError(`Failed to send test email`, 500, true, error));
  }
};

// Проверка каналов ИИ идёт по значениям формы (черновик ещё не сохранён), а
// ключ форма не получает и потому не присылает: пустое поле означает
// «использовать сохранённый» — тот же канон, что у почтовых проверок. Обе
// проверки берут группу ai целиком: распознавание умеет брать данные у
// основного провайдера, и без его блока это не разрешить.
const AI_PROVIDER_GROUPS = [
  "openai",
  "anthropic",
  "deepseek",
  "yandexai",
  "local",
];

const mergeAiDraft = (stored, incoming) => {
  const speechStored = stored.speechToText || {};
  const speechIncoming = incoming.speechToText || {};
  const merged = { ...stored, ...incoming };

  for (const group of AI_PROVIDER_GROUPS) {
    merged[group] = mergeWithStored(stored[group], incoming[group], "apiKey");
  }

  merged.speechToText = {
    ...mergeWithStored(speechStored, speechIncoming, "apiKey"),
    yandex: mergeWithStored(speechStored.yandex, speechIncoming.yandex, "apiKey"),
    local: mergeWithStored(speechStored.local, speechIncoming.local, "apiKey"),
  };

  return merged;
};

const readAiDraft = async (req) => {
  const preferences = await Preferences.findOne({});
  const stored = preferences?.ai?.toObject?.() ?? preferences?.ai ?? {};

  return mergeAiDraft(stored, req.body?.ai || {});
};

exports.checkAi = async (req, res, next) => {
  try {
    const ai = await readAiDraft(req);
    const provider = ai.provider;
    const config = ai[provider] || {};

    res.status(200).json(
      await checkProvider({
        provider,
        // Из формы ключ приходит открытым, из базы — шифртекстом
        apiKey: readStoredSecret(config.apiKey),
        model: config.model,
        folderId: config.folderId,
        baseUrl: config.baseUrl,
      }),
    );
  } catch (error) {
    next(new AppError(`Failed to check AI provider`, 500, true, error));
  }
};

exports.checkSpeechToText = async (req, res, next) => {
  try {
    const ai = await readAiDraft(req);

    res.status(200).json(await checkSpeechToText(resolveSpeechConfig(ai)));
  } catch (error) {
    next(new AppError(`Failed to check speech recognition`, 500, true, error));
  }
};

// ── Правила ИИ ────────────────────────────────────────────────────────────
// Замечания, оставленные на карточках заявок. Пока администратор не включит
// замечание, в промпты оно не попадает: одна эмоциональная формулировка иначе
// тихо испортила бы генерации всему отделу (services/aiRules.js).
const AI_RULES_LIMIT = 100;

exports.getAiRules = async (req, res, next) => {
  try {
    const rules = await AiFeedback.find({})
      .sort({ isActive: -1, updatedAt: -1 })
      .limit(AI_RULES_LIMIT)
      .lean();

    res.status(200).json({ rules });
  } catch (error) {
    next(new AppError(`Failed to fetch AI rules`, 500, true, error));
  }
};

exports.toggleAiRule = async (req, res, next) => {
  try {
    const { _id, isActive } = req.body;
    const { userId } = await getAuthData(req);

    const rule = await AiFeedback.findByIdAndUpdate(
      _id,
      {
        isActive: !!isActive,
        activatedBy: isActive ? userId : null,
        activatedAt: isActive ? new Date() : null,
      },
      { new: true },
    );

    if (!rule) return next(new AppError("Правило не найдено", 404, true));

    res.status(200).json({
      message: rule.isActive
        ? "Правило включено — ИИ учтёт его в следующих ответах"
        : "Правило выключено",
      rule,
    });
  } catch (error) {
    next(new AppError(`Failed to toggle AI rule`, 500, true, error));
  }
};

exports.deleteAiRule = async (req, res, next) => {
  try {
    const deleted = await AiFeedback.findByIdAndDelete(req.body?._id);
    if (!deleted) return next(new AppError("Правило не найдено", 404, true));

    res.status(200).json({ message: "Правило удалено" });
  } catch (error) {
    next(new AppError(`Failed to delete AI rule`, 500, true, error));
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
    let { apiKey, folderId, baseUrl } = req.body;

    // Yandex SpeechKit не отдаёт список моделей по API — возвращаем статический.
    if (feature === "speechToText" && provider === "yandex") {
      return res.status(200).json({
        models: [{ id: "general", name: "general (Yandex SpeechKit)" }],
      });
    }

    if (
      !provider ||
      !["openai", "anthropic", "deepseek", "yandexai", "local"].includes(
        provider,
      )
    ) {
      return next(new AppError("Unknown AI provider", 400, true));
    }

    if (feature === "speechToText" && !["openai", "local"].includes(provider)) {
      return next(
        new AppError(
          "Speech recognition is only supported by OpenAI, Yandex or a local server",
          400,
          true,
        ),
      );
    }

    // Fall back to the stored key/folder/address if the client didn't send them
    // — which is now the norm: the form never receives the key back, only a
    // "set" flag. У распознавания данные может давать основной провайдер,
    // поэтому его конфигурацию собирает тот же резолвер, что и вызовы.
    if (
      !apiKey ||
      (provider === "yandexai" && !folderId) ||
      (provider === "local" && !baseUrl)
    ) {
      const preferences = await Preferences.findOne({});
      const ai = preferences?.ai?.toObject?.() ?? preferences?.ai ?? {};

      if (feature === "speechToText") {
        // Берём группу ЗАПРОШЕННОГО провайдера, а не сохранённого: в форме его
        // могли только что переключить, и локальному серверу уехал бы ключ
        // OpenAI. Общие данные — из блока основного провайдера, если пара
        // совместима (у SpeechKit каталог статический, сюда он не доходит).
        const speech = ai.speechToText || {};
        const own = provider === "local" ? speech.local || {} : speech;
        const source =
          speech.useProviderCredentials &&
          canShareCredentials(ai.provider, provider)
            ? ai[ai.provider] || {}
            : own;

        if (!apiKey) apiKey = readStoredSecret(source.apiKey);
        if (!baseUrl) baseUrl = source.baseUrl || "";
      } else {
        if (!apiKey) apiKey = readStoredSecret(ai[provider]?.apiKey);
        if (!folderId) folderId = ai.yandexai?.folderId || "";
        if (!baseUrl) baseUrl = ai.local?.baseUrl || "";
      }
    }

    if (!apiKey && needsApiKey(provider)) {
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

    // Yandex AI Studio отдаёт каталог по OpenAI-совместимому адресу, но полными
    // идентификаторами: gpt://<каталог>/<модель>/<версия> вперемешку с
    // эмбеддингами (emb://) и потоковыми моделями речи. В селект чата идут
    // только генеративные, а в настройках храним путь без каталога — иначе
    // смена folder ID протухнет вместе с выбранной моделью.
    if (provider === "yandexai") {
      if (!folderId) {
        return next(
          new AppError("Yandex AI Studio folder ID is not set", 400, true),
        );
      }

      const response = await fetch(
        "https://llm.api.cloud.yandex.net/v1/models",
        {
          headers: {
            Authorization: `Api-Key ${apiKey}`,
            "x-folder-id": folderId,
          },
        },
      );

      if (!response.ok) {
        return next(
          new AppError(
            "Failed to fetch Yandex AI Studio models",
            response.status,
            true,
          ),
        );
      }

      const data = await response.json();
      models = (data.data || [])
        .map((model) => String(model.id || ""))
        .filter(
          (id) => id.startsWith("gpt://") && !id.includes("/speech-realtime-"),
        )
        .map((id) => {
          const [name, version] = id.split("/").slice(3);
          return version === "latest"
            ? { id: name, name }
            : { id: `${name}/${version}`, name: `${name} · ${version}` };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // Локальный сервер (Ollama, LM Studio, vLLM …) отдаёт каталог тем же
    // OpenAI-совместимым адресом. Эмбеддинги в чат-селект не берём: в Ollama они
    // лежат в общем списке рядом с генеративными.
    if (provider === "local") {
      const response = await fetch(`${buildLocalBaseUrl(baseUrl)}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return next(
          new AppError(
            "Failed to fetch local models",
            response.status,
            true,
          ),
        );
      }

      const data = await response.json();
      models = (data.data || [])
        .map((model) => String(model.id || ""))
        .filter((id) => id && !/embed/i.test(id))
        .map((id) => ({ id, name: id }))
        .sort((a, b) => a.id.localeCompare(b.id));
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


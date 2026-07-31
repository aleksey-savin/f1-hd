const mongoose = require("mongoose");

const workScheduleSchema = require("./workSchedule");
const { DEFAULT_OVERTIME_SCHEDULE } = require("../utils/overtimeDefaults");

const Schema = mongoose.Schema;

// Здоровье внешнего почтового канала — единый контракт для приёма и отправки.
// Пишут трое: крон сбора (backend), отправка уведомлений (telegram-bot) и ручная
// проверка из настроек; читает строка состояния в секции (app/HealthRow).
// lastMessageAt — когда канал последний раз реально сработал: забрал письмо
// (приём) или отправил его (отправка), в отличие от lastOkAt («связь есть»).
const channelHealth = () => ({
  lastCheckedAt: { type: Date, default: null },
  lastOkAt: { type: Date, default: null },
  lastMessageAt: { type: Date, default: null },
  // lastError — сама фраза состояния («Сервер отклонил пароль»), lastErrorHint —
  // приглушённая подсказка «что делать». Обе строит describeMailError, чтобы
  // UI не пытался угадать причину по коду ошибки.
  lastError: { type: String, default: "" },
  lastErrorHint: { type: String, default: "" },
  lastErrorAt: { type: Date, default: null },
  consecutiveFailures: { type: Number, default: 0 },
});

const preferencesSchema = new Schema({
  timezone: { type: String, default: "Europe/Moscow" },
  htmlTicketDesc: { type: Boolean, default: false },
  // Ящик-приёмник: письма на него становятся заявками. Транспорт задаётся
  // целиком (порт, шифрование, папка) — раньше был зашит в emailHandling.
  // Логин отдельным полем не заводим: им служит address.
  // password — шифртекст secretBox, наружу отдаётся маской (см. контроллер).
  mailbox: {
    isActive: { type: Boolean, default: false },
    address: { type: String, default: "" },
    host: { type: String, default: "" },
    port: { type: Number, default: 993 },
    security: {
      type: String,
      enum: ["ssl", "starttls", "none"],
      default: "ssl",
    },
    folder: { type: String, default: "INBOX" },
    // Отключает проверку сертификата — только для внутренних почтовиков
    allowSelfSigned: { type: Boolean, default: false },
    password: { type: String, default: "" },
    health: channelHealth(),
  },
  defaultApplicant: {
    _id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    firstName: String,
    lastName: String,
  },
  defaultCompany: {
    _id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },
    alias: String,
  },
  identifyCompany: { type: Boolean, default: false },
  identifyApplicant: { type: Boolean, default: false },
  checkPhoneNumber: { type: Boolean, default: false },
  deadline: { type: Number, default: 10 },
  // Политика повторов недоставленных уведомлений — константы бота
  // (telegram-bot/utils/retryPolicy.js), из настроек убрана осознанно
  notify: {
    personal: {
      newTicket: { type: Boolean, default: false },
      respStateUpdate: { type: Boolean, default: false },
      ticketStateUpdate: { type: Boolean, default: false },
      ticketDeadlineUpdate: { type: Boolean, default: false },
      ticketNewComment: { type: Boolean, default: false },
      scheduledWorks: { type: Boolean, default: false },
      // Отсутствия: запрос уходит согласующим, решение — заявителю.
      // Ключ категории един для personal / byTelegram / byEmail.
      absenceRequest: { type: Boolean, default: false },
      absenceDecision: { type: Boolean, default: false },
      // Согласование отчётов по услугам: запрос уходит согласующим со стороны
      // клиента, решение — нам. Ключ категории един для personal/byTelegram/byEmail.
      reportApproval: { type: Boolean, default: false },
      reportDecision: { type: Boolean, default: false },
    },
    // Канал отправки (SMTP). Транспорт задаётся так же, как у ящика-приёмника;
    // authMethod "none" — внутренний релей, принимающий почту без пароля.
    // pass — шифртекст secretBox. Письма шлёт telegram-bot, он же пишет health.
    byEmail: {
      isActive: { type: Boolean, default: false },
      host: { type: String, default: "" },
      port: { type: Number, default: 465 },
      security: {
        type: String,
        enum: ["ssl", "starttls", "none"],
        default: "ssl",
      },
      allowSelfSigned: { type: Boolean, default: false },
      authMethod: {
        type: String,
        enum: ["password", "none"],
        default: "password",
      },
      user: { type: String, default: "" },
      pass: { type: String, default: "" },
      sendFromName: { type: String, default: "" },
      sendFromEmail: { type: String, default: "" },
      health: channelHealth(),
    },
    // Единственная группа Telegram команды: сюда идут групповые уведомления и
    // здесь же живёт табло статусов; messageThreadId (ветка форум-группы)
    // действует на оба потока ("" → General-топик или не форум)
    byTelegram: {
      isActive: { type: Boolean, default: false },
      sendToGroup: { type: Boolean, default: false },
      chatId: { type: String, default: "" },
      messageThreadId: { type: String, default: "" },
    },
  },
  // Табло статусов сотрудников: одно закреплённое сообщение в группе
  // notify.byTelegram (chatId + messageThreadId), которое бот редактирует.
  // isActive — конфигурация (веб-настройки или команда /status_board);
  // messageId/lastText — служебные поля бота (кэш рендера для no-op сравнения).
  statusBoard: {
    isActive: { type: Boolean, default: false },
    messageId: { type: Number, default: null },
    lastText: { type: String, default: "" },
  },
  // Оператор такси для действия «такси» в справочнике компаний (строка списка,
  // мобильная шторка-справка). "" — действие скрыто. Каталог значений и
  // построение ссылок — frontend/src/util/taxi-operators.js (enum менять
  // синхронно): маршрут до офиса умеет только Яндекс Go, остальные операторы
  // открывают свою страницу заказа.
  taxi: {
    operator: {
      type: String,
      enum: ["", "yandexgo", "maxim", "citymobil"],
      default: "",
    },
  },
  contacts: {
    // Название организации — своего у приложения нет: компанию-исполнителя
    // везде выводят из автора документа (services/reportCard.js), а до входа
    // автора нет. Поэтому подпись на экране входа берётся отсюда, а не из кода.
    title: { type: String, default: "" },
    tel: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
    // Лого компании для навбара; пусто — в баре текстовый бренд «HelpDesk».
    // Имя файла в uploads/ (локальное хранение — читается на каждой странице)
    logo: { type: String, default: "" },
  },
  getScreen: {
    isActive: { type: Boolean, default: false },
  },
  modules: {
    timeTracking: { isActive: { type: Boolean, default: false } },
    finances: { isActive: { type: Boolean, default: false } },
    inventory: { isActive: { type: Boolean, default: false } },
    knowledgeBase: { isActive: { type: Boolean, default: false } },
  },
  // Согласование отчётов по услугам со стороны клиента.
  // Срок берётся из договора («клиент обязан согласовать в течение N дней»):
  // молчание после срока — тоже решение, и отчёт подписывается автоматически,
  // иначе он висел бы в очереди вечно. За сутки до срока всем, кто ещё не
  // подписал, уходит напоминание (services/reportAutoApproval).
  reportApproval: {
    autoApprove: {
      isActive: { type: Boolean, default: false },
      days: { type: Number, default: 5, min: 1, max: 90 },
      // Считать срок рабочими днями по производственному календарю
      // (services/productionCalendar), а не календарными
      workdaysOnly: { type: Boolean, default: false },
    },
    // Сколько ссылка из письма живёт после истечения срока согласования
    linkExtraDays: { type: Number, default: 7, min: 0, max: 90 },
  },
  // Шаблоны чек-листов (models/checklistTemplate). Один переключатель на всё
  // приложение: подходящий шаблон применяется при создании заявки сам.
  // Выключен — шаблоны никуда не деваются, но карточка предлагает их строкой.
  // Пер-категорийного выключателя нет намеренно: у категории уже есть рычаг —
  // не привязывать к ней шаблон.
  checklistTemplates: {
    autoApply: { type: Boolean, default: false },
  },
  // Расчёт переработок сотрудников (персональный отчёт). Детекция идентична
  // сводному фин. отчёту: график и период тарификации берутся из тарифа/компании;
  // резервные значения ниже — для работ вне тарифов.
  overtime: {
    defaultSchedule: {
      type: workScheduleSchema,
      default: () => DEFAULT_OVERTIME_SCHEDULE,
    },
    defaultTariffingPeriodMinutes: { type: Number, default: 15 },
    // Оплата: доплата = часы × ставка × коэффициент; на величину переработки не влияет
    weekdayCoefficient: { type: Number, default: 1 },
    weekendCoefficient: { type: Number, default: 1 },
    // Работа в праздник по производственному календарю. null — «как в выходной»:
    // так поведение существующих документов не меняется молча при выкатке.
    holidayCoefficient: { type: Number, default: null },
  },
  // Производственный календарь: праздники, переносы и сокращённые дни.
  // Снимок года лежит в отдельной коллекции (models/productionCalendar), здесь
  // только настройки и здоровье загрузчика для строки состояния (app/HealthRow).
  // isActive выключен — расчёт возвращается к правилу «нерабочий = Сб/Вс».
  productionCalendar: {
    isActive: { type: Boolean, default: true },
    country: { type: String, default: "ru" },
    source: {
      type: String,
      enum: ["xmlcalendar", "isdayoff"],
      default: "xmlcalendar",
    },
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    lastErrorAt: { type: Date, default: null },
    // Ручные исключения организации («31 декабря у нас не работаем»).
    // Перекрывают календарь страны. kind — те же значения, что у classifyDay.
    overrides: [
      {
        _id: false,
        date: { type: String, required: true }, // YYYY-MM-DD
        kind: {
          type: String,
          enum: ["work", "short", "holiday", "weekend"],
          required: true,
        },
        title: { type: String, default: "" },
      },
    ],
  },
  // Интеграция Mikrotik: мониторинг, конфигурации, прошивки, авто-заявки.
  // Независима от модуля «Учёт техники»; isActive — единый рубильник
  // (меню, API, кроны). Отсутствие поля в старых документах = включено.
  mikrotik: {
    isActive: { type: Boolean, default: true },
    // Сервисный аккаунт-автор всех машинных заявок и комментариев модуля
    // (недоступность, изменение конфигурации, уязвимости прошивки). Компания
    // сводной заявки об уязвимостях — компания этого аккаунта. Не задан →
    // авто-заявки модуля не создаются (warn в логах).
    applicant: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: false,
      },
      firstName: String,
      lastName: String,
    },
    // Устройство офлайн дольше порога → создать заявку (одну на эпизод).
    offlineTicket: {
      isActive: { type: Boolean, default: false },
      thresholdMinutes: { type: Number, default: 15 },
      categoryId: {
        type: Schema.Types.ObjectId,
        ref: "TicketCategory",
        default: null,
      },
    },
    // Running-config изменился между экспортами → создать заявку.
    configChangeTicket: {
      isActive: { type: Boolean, default: false },
      categoryId: {
        type: Schema.Types.ObjectId,
        ref: "TicketCategory",
        default: null,
      },
    },
    // В прошивке найдена опасная CVE, исправляемая обновлением → одна заявка с
    // чек-листом на все устройства (services/mikrotik/securityTicket.js).
    // minSeverity — единый порог и для индикаторов в таблице, и для заявки.
    securityUpdateTicket: {
      isActive: { type: Boolean, default: false },
      categoryId: {
        type: Schema.Types.ObjectId,
        ref: "TicketCategory",
        default: null,
      },
      minSeverity: {
        type: String,
        enum: ["high", "critical"],
        default: "high",
      },
    },
  },
  knowledgeBase: {
    moderators: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: false,
        },
        firstName: String,
        lastName: String,
      },
    ],
    hideNotApproved: { type: Boolean, default: false },
    approvalPeriodDays: { type: Number, default: 0 },
    scanForSecrets: { type: Boolean, default: false },
    trackServiceExpiry: { type: Boolean, default: false },
    serviceExpiryDays: { type: Number, default: 30 },
  },
  ai: {
    isActive: { type: Boolean, default: false },
    // Яндекс у списка один: Foundation Models переименованы в AI Studio, у них
    // общий каталог и общая авторизация (перенос старых настроек —
    // scripts/migrateAiProvider.js).
    provider: {
      type: String,
      enum: ["openai", "anthropic", "deepseek", "yandexai", "local"],
      default: "openai",
    },
    openai: {
      apiKey: { type: String, default: "" },
      model: { type: String, default: "gpt-4o" },
    },
    anthropic: {
      apiKey: { type: String, default: "" },
      model: { type: String, default: "claude-opus-4-8" },
    },
    deepseek: {
      apiKey: { type: String, default: "" },
      model: { type: String, default: "deepseek-chat" },
    },
    // Каталог моделей у каждого арендатора свой — дефолтное имя было бы
    // угадыванием, дающим 400 вместо честного «выберите модель»
    yandexai: {
      apiKey: { type: String, default: "" },
      folderId: { type: String, default: "" },
      model: { type: String, default: "" },
    },
    // Локально развёрнутая модель. Ollama, LM Studio, vLLM, llama.cpp и LocalAI
    // говорят по одному OpenAI-совместимому протоколу и различаются только
    // адресом — поэтому провайдер один на всех, а не по штуке на продукт.
    // Ключ такие серверы обычно не спрашивают; он нужен, если сервер закрыт
    // прокси с авторизацией.
    local: {
      baseUrl: { type: String, default: "" },
      apiKey: { type: String, default: "" },
      model: { type: String, default: "" },
    },
    // Состояние канала: чат-провайдер отвечает сам за себя, распознавание речи —
    // за себя (у него свой ключ и свой сервис). Пишут настоящие вызовы и кнопки
    // проверки (services/ai/health.js), читает строка состояния в настройках.
    health: channelHealth(),
    speechToText: {
      isActive: { type: Boolean, default: false },
      provider: {
        type: String,
        enum: ["openai", "yandex", "local"],
        default: "openai",
      },
      // Брать ключ (и адрес) у основного провайдера, когда он умеет то же
      // самое: у OpenAI ключ один на чат и распознавание, у Яндекса один ключ
      // Cloud открывает и AI Studio, и SpeechKit, у локального сервера один
      // адрес. Модель всегда своя — каталоги чата и распознавания разные.
      useProviderCredentials: { type: Boolean, default: false },
      apiKey: { type: String, default: "" },
      model: { type: String, default: "gpt-4o-transcribe-diarize" },
      yandex: {
        apiKey: { type: String, default: "" },
        folderId: { type: String, default: "" },
        model: { type: String, default: "general" },
      },
      // Локальный сервер распознавания: faster-whisper-server, speaches,
      // LocalAI, vLLM — все отдают OpenAI-совместимый /v1/audio/transcriptions.
      // Ollama среди них нет: аудио она не расшифровывает.
      local: {
        baseUrl: { type: String, default: "" },
        apiKey: { type: String, default: "" },
        model: { type: String, default: "" },
      },
      health: channelHealth(),
    },
  },
});

module.exports = mongoose.model("Preferences", preferencesSchema);

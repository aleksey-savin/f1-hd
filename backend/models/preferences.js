const mongoose = require("mongoose");

const workScheduleSchema = require("./workSchedule");
const { DEFAULT_OVERTIME_SCHEDULE } = require("../utils/overtimeDefaults");

const Schema = mongoose.Schema;

const preferencesSchema = new Schema({
  timezone: { type: String, default: "Europe/Moscow" },
  htmlTicketDesc: { type: Boolean, default: false },
  useEmail: { type: Boolean, default: false },
  emailAddress: { type: String, default: "" },
  emailPassword: { type: String, default: "" },
  imapServer: { type: String, default: "" },
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
  notify: {
    global: {
      attemptsInterval: { type: Number, default: 15 },
      attempts: { type: Number, default: 3 },
    },
    personal: {
      newTicket: { type: Boolean, default: false },
      respStateUpdate: { type: Boolean, default: false },
      ticketStateUpdate: { type: Boolean, default: false },
      ticketDeadlineUpdate: { type: Boolean, default: false },
      ticketNewComment: { type: Boolean, default: false },
      scheduledWorks: { type: Boolean, default: false },
    },
    byEmail: {
      isActive: { type: Boolean, default: false },
      host: { type: String, default: "" },
      isSecure: { type: Boolean, default: false },
      port: { type: Number, default: 465 },
      user: { type: String, default: "" },
      pass: { type: String, default: "" },
      sendFromName: { type: String, default: "" },
      sendFromEmail: { type: String, default: "" },
    },
    byTelegram: {
      isActive: { type: Boolean, default: false },
      sendToGroup: { type: Boolean, default: false },
      chatId: { type: String, default: "" },
    },
  },
  // Табло статусов сотрудников в Telegram-группе: одно закреплённое сообщение,
  // которое бот редактирует. isActive/chatId/messageThreadId — конфигурация
  // (веб-настройки или команда /status_board в нужной ветке); messageId/lastText —
  // служебные поля бота (кэш последнего рендера для no-op сравнения).
  statusBoard: {
    isActive: { type: Boolean, default: false },
    chatId: { type: String, default: "" }, // "" → группа уведомлений notify.byTelegram.chatId
    messageThreadId: { type: String, default: "" }, // "" → General-топик или не форум
    messageId: { type: Number, default: null },
    lastText: { type: String, default: "" },
  },
  contacts: {
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
  },
  // Управление устройствами Mikrotik: авто-заявки на события мониторинга.
  mikrotik: {
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
    provider: {
      type: String,
      enum: ["openai", "anthropic", "deepseek", "yandexgpt", "yandexai"],
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
    yandexgpt: {
      apiKey: { type: String, default: "" },
      folderId: { type: String, default: "" },
      model: { type: String, default: "yandexgpt" },
    },
    yandexai: {
      apiKey: { type: String, default: "" },
      folderId: { type: String, default: "" },
      model: { type: String, default: "deepseek-r1" },
    },
    speechToText: {
      isActive: { type: Boolean, default: false },
      provider: { type: String, enum: ["openai", "yandex"], default: "openai" },
      apiKey: { type: String, default: "" },
      model: { type: String, default: "gpt-4o-transcribe-diarize" },
      yandex: {
        apiKey: { type: String, default: "" },
        folderId: { type: String, default: "" },
        model: { type: String, default: "general" },
      },
    },
  },
});

module.exports = mongoose.model("Preferences", preferencesSchema);

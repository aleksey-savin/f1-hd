const mongoose = require("mongoose");

const { WORK_STATUS_CODES } = require("../utils/workStatuses");

const Schema = mongoose.Schema;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: String,
      default: "",
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      default: "",
    },
    profileImagePath: {
      type: String,
    },
    backgroundImagePath: {
      type: String,
    },
    position: {
      type: String,
      default: "",
    },
    company: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "Company",
      },
      alias: String,
    },
    subdivision: {
      type: Schema.Types.ObjectId,
      ref: "Subdivision",
    },
    responsibleForCompanies: [
      {
        id: {
          type: Schema.Types.ObjectId,
          ref: "Company",
        },
        alias: String,
      },
    ],
    role: {
      type: String,
    },
    categories: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "Category",
        },
        title: String,
      },
    ],
    isAdmin: {
      type: Boolean,
      default: false,
      required: true,
    },
    isEndUser: {
      type: Boolean,
      default: true,
    },
    isServiceAccount: {
      type: Boolean,
      default: false,
    },
    isCloudTelephony: { type: Boolean, default: false },
    // Статусы присутствия отключены (сторонние сотрудники): скрыт из бара,
    // списка «Люди» и Telegram-табло, переключатель статуса недоступен
    hideWorkStatus: { type: Boolean, default: false },
    permissions: {
      // tickets workflow
      canPerformTickets: { type: Boolean, default: false },
      canAdministrateTickets: { type: Boolean, default: false }, // mainly for manager, update ticket state
      canSeeAllCompanyTickets: { type: Boolean, default: false },
      canSeeAllTickets: { type: Boolean, default: false },
      canEditTickets: { type: Boolean, default: false }, // route /ticket/update/:id
      canDeleteTickets: { type: Boolean, default: false }, // route /ticket/delete/:id
      // basic portal administration
      canManageCompanies: { type: Boolean, default: false },
      canManageUsers: { type: Boolean, default: false },
      canManageTicketCategories: { type: Boolean, default: false },
      canManageRoutineTasks: { type: Boolean, default: false }, // может управлять регламентными заданиями
      canUpdateChangelog: { type: Boolean, default: false }, // может создавать записи в changelog
      canManageTicketTemplates: { type: Boolean, default: false }, // может управлять шаблонами заявок
      // time tracking module
      canUseTimeTrackingModule: { type: Boolean, default: false },
      canAvoidWorks: { type: Boolean, default: false }, // может закрыть заявку без указания работ
      canSeeWorksReport: { type: Boolean, default: false }, // может видеть отчёт по работам
      // inventory module
      canUseInventoryModule: { type: Boolean, default: false },
      canManageClientDevices: { type: Boolean, default: false },
      canManageMikrotikDevices: { type: Boolean, default: false },
      // finances module
      canUseFinancesModule: { type: Boolean, default: false },
      canManageServicePlans: { type: Boolean, default: false },
      canSeeGlobalFinancialReport: { type: Boolean, default: false },
      canConfirmReportActions: { type: Boolean, default: false },
      canSeePersonalFinancialReport: { type: Boolean, default: false },
    },
    dashboard: {
      isActive: { type: Boolean, default: false }, // может использовать дашборд
      personalActions: { type: Boolean, default: false }, // персональные задачи
      personalTasks: { type: Boolean, default: false }, // персональные задачи
      personalStats: { type: Boolean, default: false },
      globalActions: { type: Boolean, default: false }, // глобальные действия
      globalTasks: { type: Boolean, default: false }, // общие задачи
      globalStats: { type: Boolean, default: false },
    },
    notify: {
      byTelegram: {
        newTicket: { type: Boolean, default: true },
        respStateUpdate: { type: Boolean, default: true },
        ticketStateUpdate: { type: Boolean, default: true },
        ticketDeadlineUpdate: { type: Boolean, default: true },
        ticketNewComment: { type: Boolean, default: true },
        scheduledWorks: { type: Boolean, default: true },
      },
      byEmail: {
        newTicket: { type: Boolean, default: true },
        respStateUpdate: { type: Boolean, default: true },
        ticketStateUpdate: { type: Boolean, default: true },
        updatedDeadline: { type: Boolean, default: true },
        ticketNewComment: { type: Boolean, default: true },
        scheduledWorks: { type: Boolean, default: true },
      },
    },
    password: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      required: true,
    },
    lastLogin: {
      type: Date,
    },
    verifyToken: String,
    verifyTokenExpiration: Date,
    resetToken: String,
    resetTokenExpiration: Date,
    telegramBot: {
      isActive: { type: Boolean, default: false },
      chatId: { type: String, default: "" },
    },
    // Статус присутствия («в офисе», «на выезде»…). updatedAt ставится вручную
    // при смене статуса — от него считается футер «Обновлено» Telegram-табло.
    workStatus: {
      code: { type: String, enum: WORK_STATUS_CODES, default: "unset" },
      note: { type: String, default: "", maxlength: 100 },
      updatedAt: { type: Date, default: null },
    },
    getScreen: {
      api: { type: String, default: "" },
    },
    notifications: {
      lastAction: String,
      pending: Boolean,
      changelogUpdate: Boolean,
      resetToken: String,
      password: String,
    },
    darkMode: Boolean,
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);

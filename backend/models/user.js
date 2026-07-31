const mongoose = require("mongoose");

const { WORK_STATUS_CODES } = require("../utils/workStatuses");
const workScheduleSchema = require("./workSchedule");

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
    activeDirectoryObjectGUID: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    company: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "Company",
      },
      alias: String,
      // Денормализованный статус компании (каскадится из company.toggleActive;
      // при записи целого дока Company кастуется сам). В фильтрах — только
      // `{ $ne: false }`: у сотрудников без компании и старых снапшотов поля
      // нет, и это означает «активна».
      isActive: Boolean,
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
      canManageKnowledgeBase: { type: Boolean, default: false }, // может создавать/редактировать заметки базы знаний
      canSeeKnowledgeBase: { type: Boolean, default: false }, // может просматривать базу знаний
      canManageRoutineTasks: { type: Boolean, default: false }, // может управлять регламентными заданиями
      canUpdateChangelog: { type: Boolean, default: false }, // может создавать записи в changelog
      canManageTicketTemplates: { type: Boolean, default: false }, // может управлять шаблонами заявок
      // time tracking module
      canUseTimeTrackingModule: { type: Boolean, default: false },
      canAvoidWorks: { type: Boolean, default: false }, // может закрыть заявку без указания работ
      canSeeWorksReport: { type: Boolean, default: false }, // может видеть отчёт по работам
      canSeeAnalytics: { type: Boolean, default: false }, // может видеть аналитику и анализ трендов
      // Правка чужих графиков работы, заведение отсутствий и решение по
      // запросам на согласовании. Смотреть табель может любой не-клиент.
      canManageWorkSchedules: { type: Boolean, default: false },
      // inventory module
      canUseInventoryModule: { type: Boolean, default: false },
      canManageClientDevices: { type: Boolean, default: false },
      canManageMikrotikDevices: { type: Boolean, default: false },
      canManageMikrotikConfigs: { type: Boolean, default: false }, // резервные копии конфигураций Mikrotik (бэкапы/экспорт)
      // finances module
      canUseFinancesModule: { type: Boolean, default: false },
      canManageServicePlans: { type: Boolean, default: false },
      canSeeGlobalFinancialReport: { type: Boolean, default: false },
      canConfirmReportActions: { type: Boolean, default: false },
      canSeePersonalFinancialReport: { type: Boolean, default: false },
      // Клиентское право: открывает раздел «Согласование работ» на стороне
      // заказчика. Объём даёт роль, а не право (services/reportApprovalScope):
      // назначенный согласующий видит отчёт целиком, руководитель филиала —
      // только свою часть. Так же устроен доступ к отчёту «Компании».
      canApproveWorkReports: { type: Boolean, default: false },
    },
    // Часовой пояс сотрудника (IANA). null — берётся Preferences.timezone.
    // От него считаются границы его суток, норма и переработки: без этого поля
    // смена инженера из UTC+10 целиком попадала в «до 09:00 по Москве» и
    // числилась переработкой (см. services/workCalendar).
    timezone: { type: String, default: null },
    /**
     * Как ведётся рабочее время человека.
     *   scheduled — штат: статус присутствия меняет автоматика по графику,
     *               отсутствия оформляются заявкой, считается норма;
     *   free      — вне графика: в календаре виден, но автоматика его не
     *               трогает, статусы (включая отпуск и больничный) ставит сам;
     *   none      — в календаре не показывается вовсе (подрядчики, разовые
     *               монтажники — их рабочим временем мы не управляем).
     */
    workTimeMode: {
      type: String,
      enum: ["scheduled", "free", "none"],
      default: "scheduled",
    },
    // Работает только удалённо: статуса «в офисе» у него нет ни в
    // переключателе, ни в автоматике (там вместо него «на удалёнке»).
    remoteOnly: { type: Boolean, default: false },
    /**
     * История недельных графиков. Версия действует с effectiveFrom до начала
     * следующей; null в effectiveFrom — «действует всегда» (так лежит запись,
     * созданная миграцией из прежнего одиночного workSchedule).
     * Пустой массив — каскад как раньше: график тарифа/компании, затем
     * Preferences.overtime.defaultSchedule.
     */
    workSchedules: [
      {
        _id: false,
        effectiveFrom: { type: Date, default: null },
        schedule: { type: workScheduleSchema, required: true },
        followProductionCalendar: { type: Boolean, default: true },
        createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // ЛЕГАСИ, только на чтение: перенесено в workSchedules[] миграцией
    // migrateWorkSchedules.js. Удалить следующим релизом.
    workSchedule: { type: workScheduleSchema, default: null },
    followProductionCalendar: { type: Boolean, default: true },
    // Финансовые параметры сотрудника: видны самому пользователю, isAdmin и
    // обладателям canSeeGlobalFinancialReport (getOne вырезает поле остальным)
    finances: {
      salary: { type: Number, default: null }, // оклад, ₽/мес
      overtimeHourlyRate: { type: Number, default: null }, // ставка переработок, ₽/час
    },
    notify: {
      byTelegram: {
        newTicket: { type: Boolean, default: true },
        respStateUpdate: { type: Boolean, default: true },
        ticketStateUpdate: { type: Boolean, default: true },
        ticketDeadlineUpdate: { type: Boolean, default: true },
        ticketNewComment: { type: Boolean, default: true },
        scheduledWorks: { type: Boolean, default: true },
        // Отсутствия: запрос согласующим, решение заявителю
        absenceRequest: { type: Boolean, default: true },
        absenceDecision: { type: Boolean, default: true },
        // Согласование отчётов: запрос согласующему клиента, решение нам
        reportApproval: { type: Boolean, default: true },
        reportDecision: { type: Boolean, default: true },
      },
      byEmail: {
        newTicket: { type: Boolean, default: true },
        respStateUpdate: { type: Boolean, default: true },
        ticketStateUpdate: { type: Boolean, default: true },
        // Ключ категории един для prefs.notify.personal / byTelegram / byEmail
        // (см. notifyTg/notifyEmail в middleware/notifications.js); прежнее имя
        // updatedDeadline было рассинхронено и нигде не читалось.
        ticketDeadlineUpdate: { type: Boolean, default: true },
        ticketNewComment: { type: Boolean, default: true },
        scheduledWorks: { type: Boolean, default: true },
        // Отсутствия: запрос согласующим, решение заявителю
        absenceRequest: { type: Boolean, default: true },
        absenceDecision: { type: Boolean, default: true },
        // Согласование отчётов: запрос согласующему клиента, решение нам
        reportApproval: { type: Boolean, default: true },
        reportDecision: { type: Boolean, default: true },
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
    // Денормализованная «последняя активность» = дата последней созданной
    // пользователем заявки. Обновляется хуком модели ticket при создании
    // заявки; питает сортировку/фильтр «активности» в списке «Пользователи»
    // без агрегата по коллекции tickets на каждый запрос.
    lastActivityAt: {
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
      // Кто поставил: автоматика по графику/отсутствию или сам человек.
      // Ручной живёт до конца суток, автоматический можно менять свободно —
      // и при смене режима учёта он сбрасывается, а ручной остаётся
      auto: { type: Boolean, default: false },
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

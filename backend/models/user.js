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
      // Индекс объявлен уникальным, но регистр не нормализовался: адрес
      // сохранялся как введён, а `controllers/user.js#add` искал дубль по
      // сырому значению — «Ivanov@f1lab.ru» и «ivanov@f1lab.ru» могли завестись
      // оба. better-auth приводит адрес к нижнему регистру, и такая пара
      // означала бы вход под чужой учёткой. На 2026-08 данные чистые (проверено
      // scripts/checkEmailCollisions.js), сеттеры закрывают вход новым.
      lowercase: true,
      trim: true,
    },
    // Нужно better-auth: при `requireEmailVerification` он не пускает без него.
    // Существующим проставлено true миграцией — эти учётки заводил
    // администратор, и требовать от них подтверждения задним числом значило бы
    // запереть снаружи 694 человека.
    emailVerified: {
      type: Boolean,
      default: false,
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
    // Свободный текстовый ЯРЛЫК должности («директор», «бухгалтер»). В
    // авторизации не участвует, но копируется в денормализованные снапшоты
    // Company.users[].role и Ticket.applicant.role — переименовать его нельзя,
    // копии уже разошлись по 13 тысячам заявок. Роль доступа — это roleId ниже.
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
    // НЕ обязателен с 2026-08: человека можно завести приглашением, и пароля у
    // него не будет вовсе, пока он не задаст его сам. Несозданный пароль нельзя
    // ни угадать, ни утечь. Само поле — дубль хеша из `authAccounts` и уходит
    // в уборке; источник истины для better-auth там.
    password: {
      type: String,
    },
    // Ставится плагином twoFactor better-auth. Поле обязано быть в схеме:
    // strict mode вырезал бы его при первом же user.save() из нашего кода, и
    // двухфакторка молча выключилась бы.
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    // Отключение учётки. Пришло на смену `isActive` вместе с плагином `admin`:
    // он сам проверяет флаг при создании сеанса, сам снимает просроченный бан
    // по `banExpires` и сам отзывает сеансы — у `isActive` из этого не было
    // ничего, отключённый жил до истечения своего токена.
    //
    // ПОЛЯРНОСТЬ ОБРАТНАЯ остальным сущностям: у категорий и компаний
    // `isActive: true` значит «работает», здесь «не работает» — `banned:
    // true`. Отсюда фильтры вида `{ banned: { $ne: true } }`, а не `true`:
    // поля может не быть вовсе, и его отсутствие значит «работает».
    //
    // `required` нет намеренно: better-auth пишет пользователя нативным
    // драйвером мимо валидации Mongoose, и обязательное поле сломало бы его
    // собственные ручки, а не нас.
    banned: {
      type: Boolean,
      default: false,
    },
    // Причину видит администратор в карточке; человеку она не показывается —
    // текст пишется для своих и в чужие руки не рассчитан.
    banReason: String,
    // Пусто = бессрочно. Просроченный бан плагин снимает сам при входе.
    banExpires: Date,
    lastLogin: {
      type: Date,
    },
    // Когда человеку отправили приглашение. Вместе с пустым `lastLogin` даёт
    // ответ на вопрос «дошло ли»: из 98 заведённых за год учёток 76 не входили
    // ни разу, и узнать об этом было неоткуда.
    invitedAt: {
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
    // Привязка телеграма. `chatId` — идентификатор ЛИЧНОГО чата, он же id
    // пользователя в Telegram. Ставится только обменом одноразового кода
    // (`services/telegramActor#bindChat`) и снимается владельцем; из тела
    // запроса не принимается — иначе на чужой чат можно указать себе сам.
    telegramBot: {
      isActive: { type: Boolean, default: false },
      chatId: { type: String, default: "" },
      // Когда привязали. Раньше о привязке не оставалось ничего: ни времени, ни
      // следа, и захват учётки был бы невидим и нереконструируем.
      linkedAt: { type: Date, default: null },
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

const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Снапшот человека в подписи: карточка и уведомления обязаны называть имя, а
// не ObjectId (см. docs/ux-ui-guide.md, «Статус, который протухает»).
const actorSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, ref: "User" },
    firstName: String,
    lastName: String,
  },
  { _id: false },
);

/**
 * Часть отчёта по подразделению клиента.
 *
 * Появляется, только когда у привязки услуги включено
 * `subdivisionApprovalRequired`: работы делятся по филиалам (атрибуция —
 * services/workSubdivision, по заявителю самой ранней заявки), и каждую часть
 * подписывает руководитель своего филиала. Отказ одной части не сжигает
 * подписи остальных — возвращается только спорная.
 *
 * Очередь идёт СНИЗУ ВВЕРХ по иерархии подразделений: сначала самые нижние,
 * и только когда подписаны все нижние части ветки, очередь доходит до
 * вышестоящего подразделения (services/reportApproval, advanceWaves). Отсюда
 * `waiting` — часть существует, но её руководителя ещё не беспокоили: ни
 * письма, ни ссылки у него нет.
 */
const partSchema = new Schema(
  {
    // null — «Без подразделения»: работы, для которых филиал не разрешился.
    // Такую часть подписывает финальный согласующий вместе с итогом.
    subdivision: {
      type: Schema.Types.ObjectId,
      ref: "Subdivision",
      default: null,
    },
    subdivisionName: String,
    works: [{ type: Schema.Types.ObjectId, ref: "Work" }],
    price: { type: Number, default: 0 },
    additionalPrice: { type: Number, default: 0 },
    status: {
      type: String,
      // waiting — очередь ещё не дошла, pending — ждём решения именно сейчас
      enum: ["waiting", "pending", "approved", "declined"],
      default: "pending",
      required: true,
    },
    decidedBy: { type: actorSchema, default: null },
    decidedAt: { type: Date, default: null },
    // Причина отказа уходит исполнителю уведомлением — значит человеческая
    comment: { type: String, default: "", maxlength: 500 },
  },
  { _id: true },
);

/** Событие жизненного цикла отчёта — источник секции «История» на карточке. */
const timelineSchema = new Schema(
  {
    at: { type: Date, required: true },
    // contractor — мы, customer — сторона клиента, system — автосогласование
    actor: {
      type: String,
      enum: ["contractor", "customer", "system"],
      required: true,
    },
    by: { type: actorSchema, default: null },
    action: {
      type: String,
      enum: [
        "submitted",
        "resubmitted",
        "approved",
        "declined",
        "autoApproved",
        "reminded",
        "invoiced",
        "paid",
        "archived",
      ],
      required: true,
    },
    // report — решение по отчёту целиком, subdivision — по одной части
    scope: {
      type: String,
      enum: ["report", "subdivision"],
      default: "report",
    },
    subdivision: {
      type: Schema.Types.ObjectId,
      ref: "Subdivision",
      default: null,
    },
    subdivisionName: String,
    comment: { type: String, default: "" },
  },
  { _id: false },
);

const servicePlanReportSchema = new Schema(
  {
    company: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    servicePlan: {
      type: Schema.Types.ObjectId,
      ref: "ServicePlan",
      required: true,
    },
    works: [
      {
        type: Schema.Types.ObjectId,
        ref: "Work",
      },
    ],
    price: { type: Number, default: 0 },
    additionalPrice: { type: Number, default: 0 },
    periodFrom: Date,
    periodTo: Date,
    invoice: {
      number: String,
      date: Date,
      fullyPaidAt: Date,
    },
    status: {
      type: String,
      enum: [
        "pendingApproval",
        "approved",
        "awaitingPayment",
        "paid",
        "archived",
        "declined",
      ],
      required: true,
      default: "pendingApproval",
    },

    /**
     * Согласование со стороны клиента. Раньше отчёт уходил в `pendingApproval`
     * и застревал там навсегда: ни эндпоинта, ни экрана, ни срока.
     */
    approval: {
      // Снимок настроек привязки услуги на момент отправки: поменяют настройку
      // позже — уже отправленный отчёт не должен менять маршрут на ходу
      required: { type: Boolean, default: false },
      bySubdivisions: { type: Boolean, default: false },
      finalApprover: { type: actorSchema, default: null },
      submittedAt: { type: Date, default: null },
      // Срок по договору: после него отчёт подписывается автоматически
      // (services/reportAutoApproval). Пока часть на правке у нас — null:
      // договорный срок не должен съедаться нашей же задержкой.
      deadlineAt: { type: Date, default: null },
      // Напоминание за сутки уходит один раз на попытку
      remindedAt: { type: Date, default: null },
      autoApprovedAt: { type: Date, default: null },
    },

    parts: [partSchema],

    // Номер попытки: отклонённый отчёт правится и уходит повторно, история
    // копится на одном документе, а не рвётся на цепочку мёртвых
    attempt: { type: Number, default: 1 },

    timeline: [timelineSchema],

    /**
     * Доступ по ссылке из письма — половина согласующих в приложение не
     * заходит. Токен ПЕРСОНАЛЬНЫЙ: подпись обязана иметь имя, иначе в истории
     * останется «согласовано по ссылке» без человека. У руководителя филиала
     * токен ведёт на его часть.
     */
    accessTokens: [
      {
        _id: false,
        token: { type: String, required: true },
        user: { type: actorSchema, required: true },
        subdivision: {
          type: Schema.Types.ObjectId,
          ref: "Subdivision",
          default: null,
        },
        expiresAt: { type: Date, required: true },
        usedAt: { type: Date, default: null },
      },
    ],

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },

  { timestamps: true },
);

// Очередь автосогласования: «кому вышел срок» и «кому пора напомнить»
servicePlanReportSchema.index({ status: 1, "approval.deadlineAt": 1 });
// Вход по ссылке из письма
servicePlanReportSchema.index({ "accessTokens.token": 1 }, { sparse: true });
// Конвейер и карточка компании: отчёты компании по периодам
servicePlanReportSchema.index({ company: 1, periodFrom: -1 });
// Очередь руководителя филиала: «что ждёт моего решения»
servicePlanReportSchema.index({ "parts.subdivision": 1, "parts.status": 1 });

// Живые обновления согласования (см. services/pulseTopics.js)
servicePlanReportSchema.plugin(require("../../services/pulsePlugin"), {
  model: "ServicePlanReport",
});

module.exports = mongoose.model("ServicePlanReport", servicePlanReportSchema);

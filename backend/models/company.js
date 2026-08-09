const mongoose = require("mongoose");

const workSchedule = require("./workSchedule");

const Schema = mongoose.Schema;

const companySchema = new Schema(
  {
    alias: {
      type: String,
      required: true,
    },
    fullTitle: {
      type: String,
      required: true,
    },
    // Активность компании: false — обслуживание прекращено (вход её
    // пользователей, машинные каналы и выдачи гасятся). У документов до
    // фичи поля нет, поэтому в запросах фильтруем `isActive: { $ne: false }`
    // (отсутствие = активна, бэкфил не нужен).
    isActive: {
      type: Boolean,
      default: true,
    },
    profileImagePath: String,
    emailDomains: [
      {
        type: String,
        required: false,
      },
    ],
    phones: [
      {
        type: String,
        required: false,
      },
    ],
    address: { type: String, required: false },
    linkToMap: { type: String, required: false },
    subdivisions: [
      {
        type: Schema.Types.ObjectId,
        ref: "Subdivision",
      },
    ],
    users: [
      {
        id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        fullName: String,
        email: String,
        phone: String,
        position: String,
        role: String,
        isActive: Boolean,
      },
    ],
    employees: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    responsibles: [
      {
        id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        position: String,
        role: String,
        isActive: Boolean,
      },
    ],
    clientsSideResponsibles: [
      {
        id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        position: String,
        role: String,
        isActive: Boolean,
      },
    ],
    locationSettings: {
      allowTracking: Boolean,
      latitude: Number,
      longitude: Number,
      title: String,
      radius: Number,
    },
    workSchedule: workSchedule,
    // Часовой пояс клиента (IANA): в нём читается workSchedule и показывается
    // местное время. null — берётся Preferences.timezone. Подразделение может
    // переопределить (см. services/clientTimezone).
    timezone: {
      type: String,
      default: null,
    },
    servicePlans: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "ServicePlan",
        },
        isActiveSince: Date,
        // Отчёт по этой услуге уходит на согласование клиенту
        customerApprovalRequired: Boolean,
        // Кто подписывает со стороны клиента. Снапшот имени — карточка отчёта
        // и уведомления называют человека, а не ObjectId.
        approver: {
          _id: { type: Schema.Types.ObjectId, ref: "User" },
          firstName: String,
          lastName: String,
        },
        // Отчёт делится на части по подразделениям клиента, каждую подписывает
        // руководитель своего филиала (subdivision.manager), и только после
        // всех частей отчёт уходит на финальную подпись `approver`.
        subdivisionApprovalRequired: Boolean,
      },
    ],
    apiKeys: [
      {
        /**
         * ЗНАЧЕНИЕ КЛЮЧА — ПЕРЕХОДНОЕ ПОЛЕ, оно удаляется.
         *
         * Ключ хранился строкой, то есть любая выгрузка базы или бэкап давали
         * готовый доступ на заведение заявок от имени компании. Сравнение
         * переведено на `keyHash`; само значение остаётся, пока каждый живой
         * ключ не докажет, что проходит через новый поиск (`lastUsedAt` после
         * перевода). До этого момента откат стоит одну строку, после —
         * восстановить ключи будет неоткуда.
         */
        key: {
          type: String,
          required: false,
        },
        /** sha256 значения. По нему и идёт проверка. */
        keyHash: {
          type: String,
          required: false,
        },
        /**
         * Последние четыре знака — чтобы ключ можно было опознать в списке и
         * сверить с тем, что прописано в интеграции. Показывать больше нечего:
         * значения у нас не будет.
         */
        keyTail: {
          type: String,
          default: "",
        },
        /**
         * Когда ключом в последний раз пользовались. Когда значение прочитать
         * нельзя, это единственный способ отличить живой ключ от забытого — и
         * он же признак, что ключ уже прошёл через новый поиск.
         *
         * Пишется не чаще раза в час: иначе каждое обращение интеграции
         * означало бы запись в базу.
         */
        lastUsedAt: {
          type: Date,
          default: null,
        },
        name: {
          type: String,
          required: true,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        createdBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

const Company = mongoose.model("Company", companySchema);

module.exports = Company;

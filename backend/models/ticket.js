const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const CounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", CounterSchema);

const STARTING_NUMBER = process.env.TICKET_COUNTER_STARTING_NUMBER || 45926;

const attachmentSchema = new Schema(
  {
    mimetype: String,
    mimeType: String,
    name: String,
    originalName: String,
    size: Number,
    speechToText: {
      status: {
        type: String,
        enum: ["idle", "pending", "ready", "error"],
        default: "idle",
      },
      text: { type: String, default: "" },
      summary: { type: String, default: "" },
      segments: [
        {
          speaker: String,
          text: String,
          start: Number,
          end: Number,
        },
      ],
      model: String,
      error: { type: String, default: "" },
      // Начало распознавания — точка отсчёта для срока ожидания: перезапуск
      // процесса убивает расшифровку молча, и без срока вложение осталось бы
      // «распознаётся» навсегда (services/speechToTextService.js).
      startedAt: Date,
      generatedAt: Date,
    },
  },
  { _id: false },
);

// Initialize counter if it doesn't exist
const initCounter = async () => {
  try {
    const counter = await Counter.findById("ticketNum");
    if (!counter) {
      await Counter.create({
        _id: "ticketNum",
        seq: STARTING_NUMBER - 1, // Start one less as it will be incremented on first use
      });
    }
  } catch (error) {
    console.error("Failed to initialize counter:", error);
  }
};

// Call this when your application starts
initCounter();

const ticketDefaultFieldsSchema = new Schema({
  title: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
  categoryId: {
    type: Schema.Types.ObjectId,
    ref: "TicketCategory",
    required: false,
  },
  // ------------------------
  company: {
    _id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
    },
    alias: {
      type: String,
    },
  },
  customFields: [
    {
      name: String,
      type: {
        type: String,
        enum: ["text", "select", "multiselect"],
      },
      value: Schema.Types.Mixed,
      options: [String],
    },
  ],
  impact: {
    type: String,
    enum: ["Низкое", "Среднее", "Высокое"],
  },
  urgency: {
    type: String,
    enum: ["Низкая", "Средняя", "Высокая"],
  },
  priority: {
    type: String,
    enum: ["Планируемый", "Низкий", "Средний", "Высокий", "Критический"],
  },
});

const ticketSchema = new Schema(
  {
    num: {
      type: Number,
      unique: true,
    },
    ...ticketDefaultFieldsSchema.obj,
    htmlDescription: {
      type: String,
      required: false,
    },
    attachments: [attachmentSchema],
    template: {
      type: Schema.Types.ObjectId,
      ref: "TicketTemplate",
    },
    routineTask: {
      type: Schema.Types.ObjectId,
      ref: "RoutineTask",
    },
    isClosed: {
      type: Boolean,
      required: true,
      default: false,
    },
    realSender: {
      type: String,
      required: false,
    },
    applicantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    // Устройство, о котором заявка (авто-заявки мониторинга Mikrotik: офлайн /
    // изменение конфигурации). Питает вкладку «Окружение» — у таких заявок
    // автор служебный и рабочего места не имеет.
    relatedClientDeviceId: {
      type: Schema.Types.ObjectId,
      ref: "ClientDevice",
    },
    // legacy, delete after 1.8.9
    applicant: {
      _id: {
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
    // ------------------------
    company: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "Company",
      },
      alias: {
        type: String,
      },
    },
    state: {
      type: String,
      enum: [
        "Новая",
        "Не в работе",
        "В работе",
        "На согласовании",
        "Выполнена",
        "Закрыта",
      ],
      required: true,
    },
    notifications: {
      lastAction: {
        type: String,
        enum: [
          "new ticket",
          "process ticket",
          "take ticket to work",
          "request help",
          "join responsibles",
          "update deadline",
          "reject ticket",
          "close ticket",
          "back to work",
        ],
      },
      pending: Boolean,
      destination: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    },
    comments: [
      {
        type: Schema.Types.ObjectId,
        ref: "Comment",
      },
    ],
    source: {
      type: String,
      enum: [
        "Портал",
        "Почта",
        "Облачная телефония",
        "Telegram",
        "Регламентное задание",
        "Мониторинг устройств",
        "Другое",
      ],
      required: true,
      default: "Другое",
    },
    responsibles: [
      {
        _id: {
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
        isNotified: {
          telegram: Boolean,
          email: Boolean,
        },
      },
    ],
    removedFromResponsibles: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        firstName: String,
        lastName: String,
        isNotified: {
          telegram: Boolean,
          email: Boolean,
        },
      },
    ],
    rejected: [
      {
        by: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        reason: String,
      },
    ],
    closingComment: String,
    returningComment: String,
    deadline: Date,
    checklist: [
      {
        description: String,
        mandatory: Boolean,
        checked: Boolean,
        checkedAt: Date,
        checkedBy: {
          _id: {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
          firstName: String,
          lastName: String,
        },
      },
    ],
    isArchived: { type: Boolean, default: false },

    aiGuide: {
      status: {
        type: String,
        enum: ["idle", "pending", "ready", "error"],
        default: "idle",
      },
      kind: {
        type: String,
        enum: ["solution", "questions"],
      },
      summary: { type: String, default: "" },
      items: [
        {
          text: String,
          done: { type: Boolean, default: false },
        },
      ],
      // Заметки базы знаний, использованные при генерации руководства.
      // Поле "type" объявлено как { type: String }, иначе Mongoose принимает
      // объект за дескриптор типа и трактует sources как массив строк.
      sources: [
        {
          _id: {
            type: Schema.Types.ObjectId,
            ref: "KnowledgeNote",
          },
          title: String,
          type: { type: String },
        },
      ],
      provider: String,
      model: String,
      error: { type: String, default: "" },
      // Когда сборка ушла в работу. Она идёт в живом запросе, и перезапуск
      // процесса (деплой) убивает её молча: ошибки нет, а статус остался
      // pending — карточка опрашивала бы его вечно. По этой отметке
      // просроченный pending считается прерванным (services/ticketAiGuide.js).
      startedAt: Date,
      generatedAt: Date,
      generatedFromCommentCount: { type: Number, default: 0 },
    },

    // Понятийный аппарат заявки: предметные понятия и справка по каждому.
    // Справка — про предмет, а не про эту заявку, поэтому она переиспользуема:
    // сохранённая в базу знаний, она приезжает в следующую такую заявку обычным
    // подбором заметок, уже без вызова модели.
    aiTerms: {
      status: {
        type: String,
        enum: ["idle", "pending", "ready", "error"],
        default: "idle",
      },
      // Срок жизни pending — как у руководства: перезапуск процесса убивает
      // разбор молча (services/ticketAiTerms.js)
      startedAt: Date,
      error: { type: String, default: "" },
      generatedAt: Date,
      items: [
        {
          _id: false,
          term: { type: String, required: true },
          // Встречается ли понятие в тексте заявки дословно. Считаем кодом, а не
          // моделью: от этого зависит, подчеркнём мы слово в описании или
          // покажем строкой «Ещё в теме» — граница между словами человека и
          // домыслом модели должна быть точной.
          inText: { type: Boolean, default: false },
          // Пусто, пока справку не открывали: генерируем по требованию
          reference: {
            summary: { type: String, default: "" },
            blocks: [
              {
                _id: false,
                title: String,
                kind: { type: String, enum: ["text", "list", "steps"] },
                text: String,
                items: [String],
              },
            ],
            // Только ссылки, ответившие на живой запрос: модель выдумывает
            // адреса охотнее, чем факты
            links: [{ _id: false, url: String, title: String, host: String }],
            provider: String,
            model: String,
            generatedAt: Date,
          },
        },
      ],
    },

    // Состояние фоновой обработки аудиозаписи звонка распознаванием речи
    aiSpeech: {
      status: {
        type: String,
        enum: ["pending", "processed", "error"],
      },
      // Когда распознавание ушло в работу. Оно идёт фоновой задачей, и
      // перезапуск процесса убивает её без исключения — статус остался бы
      // pending навсегда, а по нему стоит гейт уведомлений: о заявке не узнал
      // бы никто (срок ожидания — middleware/notifications.js).
      startedAt: Date,
    },

    // Состояние фонового автоопределения категории заявки ИИ
    aiCategory: {
      status: {
        type: String,
        enum: ["pending", "processed", "error"],
      },
    },

    // Тема, написанная ИИ вместо человека. Ставится только заявкам, где темы не
    // было вовсе (заявитель поля «Тема» не видит): при создании сервер кладёт
    // тему, выведенную из описания, а этот статус говорит, что её можно
    // заменить на модельную — и что у заголовка карточки нужна метка ✦.
    // Пишется тем же проходом, что подбирает категорию
    // (services/ticketCategoryService.js).
    aiTitle: {
      status: {
        type: String,
        enum: ["pending", "processed", "error"],
      },
    },

    // Timestamps
    processedAt: Date,
    startedAt: Date,
    finishedAt: Date,

    // Responsibles & applicants
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    startedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    finishedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
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

    // Токен оптимистичной блокировки. Инкрементится только пользовательскими
    // мутациями жизненного цикла/редактирования (см. controllers/ticket.js),
    // поэтому комментарии и фоновые ИИ-записи не вызывают ложных конфликтов.
    version: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

ticketSchema.pre("save", async function (next) {
  try {
    if (this.isNew) {
      const counter = await Counter.findByIdAndUpdate(
        "ticketNum",
        { $inc: { seq: 1 } },
        {
          new: true,
          upsert: true,
        },
      );
      this.num = counter.seq;
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Add database indexes for better query performance
ticketSchema.index({ isClosed: 1, _id: -1 }); // For getAllOpened query
ticketSchema.index({ isClosed: 1, "company._id": 1 }); // For company-specific queries
ticketSchema.index({ "responsibles._id": 1 }); // For responsible user queries
ticketSchema.index({ createdBy: 1 }); // For created by queries
ticketSchema.index({ applicantId: 1, createdAt: -1 }); // For applicant queries + latest-per-applicant
// num field already has unique: true, no additional index needed
ticketSchema.index({ state: 1 }); // For state-based queries
ticketSchema.index({ createdAt: -1 }); // For date-based sorting
ticketSchema.index({ updatedAt: -1 }); // For recent updates
ticketSchema.index({ deadline: 1 }); // For deadline queries
ticketSchema.index({ categoryId: 1 }); // For category-based queries
ticketSchema.index({ isArchived: 1 }); // For archived status
ticketSchema.index({ source: 1 }); // For source-based queries
ticketSchema.index({ finishedAt: 1 }); // For completion date queries
ticketSchema.index({ routineTask: 1 }); // For routine task queries
ticketSchema.index({
  "notifications.pending": 1,
  "notifications.destination": 1,
}); // For notifications

// Compound indexes for common query patterns
ticketSchema.index({ isClosed: 1, createdAt: -1 }); // For recent open tickets
ticketSchema.index({ isClosed: 1, deadline: 1 }); // For open tickets with deadlines
ticketSchema.index({ state: 1, createdAt: -1 }); // For state-based date sorting
ticketSchema.index({ "company._id": 1, isClosed: 1, createdAt: -1 }); // For company tickets
ticketSchema.index({ "responsibles._id": 1, isClosed: 1, createdAt: -1 }); // For user's tickets
ticketSchema.index({ isClosed: 1, finishedAt: -1, _id: -1 }); // Архив: листинг закрытых по дате закрытия (_id — тай-брейкер сортировки, чтобы sort шёл по индексу)
ticketSchema.index({ "applicant._id": 1, createdAt: -1 }); // For latest-ticket-per-applicant (legacy embedded applicant)

// «Последняя активность» пользователя = дата его последней созданной заявки.
// Денормализуем её на User.lastActivityAt при СОЗДАНИИ заявки, чтобы список
// «Пользователи» сортировал/фильтровал по активности без агрегата по коллекции
// tickets. Хук централизует обновление по всем путям создания заявки (форма,
// e-mail, регламент, Mikrotik). Пометку «новая» ставим в pre-save (в post-save
// isNew уже сброшен), а обновление User делаем fire-and-forget: его сбой не
// должен ронять создание заявки.
ticketSchema.pre("save", function markTicketAsNew(next) {
  this.$locals.wasNew = this.isNew;
  next();
});
ticketSchema.post("save", function touchApplicantActivity(doc) {
  if (!doc.$locals || !doc.$locals.wasNew) return;
  const applicantId = doc.applicantId || (doc.applicant && doc.applicant._id);
  if (!applicantId) return;
  mongoose
    .model("User")
    .updateOne(
      { _id: applicantId },
      { $set: { lastActivityAt: doc.createdAt || new Date() } },
    )
    .catch((error) =>
      console.warn(
        "lastActivityAt пользователя не обновлён:",
        error?.message || error,
      ),
    );
});

const Ticket = mongoose.model("Ticket", ticketSchema);

module.exports = {
  Ticket,
  ticketDefaultFieldsSchema,
  // Export function to reset/initialize counter with custom start number
  initializeCounter: async (startNumber = STARTING_NUMBER) => {
    await Counter.findByIdAndUpdate(
      "ticketNum",
      { seq: startNumber - 1 },
      { upsert: true },
    );
  },
};

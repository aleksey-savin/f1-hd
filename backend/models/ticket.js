const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const CounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", CounterSchema);

const STARTING_NUMBER = process.env.TICKET_COUNTER_STARTING_NUMBER || 45926;

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
    attachments: [
      {
        mimetype: String,
        name: String,
        originalName: String,
      },
    ],
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
ticketSchema.index({ applicantId: 1 }); // For applicant queries
ticketSchema.index({ num: 1 }); // For ticket number lookups
ticketSchema.index({ state: 1 }); // For state-based queries
ticketSchema.index({ createdAt: -1 }); // For date-based sorting
ticketSchema.index({ updatedAt: -1 }); // For recent updates
ticketSchema.index({ deadline: 1 }); // For deadline queries
ticketSchema.index({ categoryId: 1 }); // For category-based queries
ticketSchema.index({ isArchived: 1 }); // For archived status
ticketSchema.index({ source: 1 }); // For source-based queries
ticketSchema.index({ finishedAt: 1 }); // For completion date queries
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

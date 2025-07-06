const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const CounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", CounterSchema);

const STARTING_NUMBER = process.env.TICKET_COUNTER_STARTING_NUMBER || 45927;

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
    console.error("Failed to initialize counter:", {
      error: error.message,
      stack: error.stack,
    });
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
  // legacy, delete after 1.8.9
  category: {
    _id: {
      type: Schema.Types.ObjectId,
      ref: "TicketCategory",
      required: false,
    },
    title: String,
    description: {
      type: String,
    },
    users: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        firstName: String,
        lastName: String,
      },
    ],
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

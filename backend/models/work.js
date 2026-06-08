const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const workSchema = new Schema(
  {
    description: {
      type: String,
      required: false,
    },
    visitRequired: {
      type: Boolean,
      required: false,
    },
    startedAt: {
      type: Date,
      required: false,
    },
    finishedAt: {
      type: Date,
      required: false,
    },
    finishedBy: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: false,
      },
      firstName: String,
      lastName: String,
      profileImagePath: String,
    },
    scheduled: {
      type: Boolean,
      required: false,
    },
    planningToStart: {
      type: Date,
      required: false,
    },
    planningToFinish: {
      type: Date,
      required: false,
    },
    executor: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: false,
      },
      firstName: String,
      lastName: String,
      profileImagePath: String,
    },
    tickets: [
      {
        type: Schema.Types.ObjectId,
        ref: "Ticket",
        required: true,
      },
    ],
    company: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    withinPlan: {
      type: Boolean,
      required: false,
      default: false,
    },
    notifications: {
      lastAction: String,
      pending: Boolean,
    },
    finances: {
      status: {
        type: String,
        enum: [
          "preview",
          "pendingApproval",
          "approved",
          "declined",
          "underReview",
        ],
      },
      contractor: {
        isConfirmed: Boolean,
        confirmedAt: Date,
        confirmedBy: {
          _id: {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
          firstName: String,
          lastName: String,
        },
      },
      customer: {
        isConfirmed: Boolean,
        confirmedAt: Date,
        confirmedBy: {
          _id: {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
          firstName: String,
          lastName: String,
        },
      },
    },
    createdBy: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      firstName: String,
      lastName: String,
    },
    updatedBy: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      firstName: String,
      lastName: String,
    },
  },
  { timestamps: true },
);

// Под выборку запланированных работ по заявкам в getAllOpened
workSchema.index({ tickets: 1, scheduled: 1, finishedAt: 1 });

module.exports = mongoose.model("Work", workSchema);

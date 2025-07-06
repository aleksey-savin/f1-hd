const mongoose = require("mongoose");

const Schema = mongoose.Schema;

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

module.exports = mongoose.model("ServicePlanReport", servicePlanReportSchema);

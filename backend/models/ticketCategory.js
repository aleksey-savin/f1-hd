const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const ticketCategorySchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      required: false,
    },
    alwaysWithinPlan: {
      type: Boolean,
      required: false,
    },
    isActive: {
      type: Boolean,
      required: true,
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
    servicePlans: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "ServicePlan",
        },
        title: String,
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

module.exports = mongoose.model("TicketCategory", ticketCategorySchema);

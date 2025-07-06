const mongoose = require("mongoose");
const { ticketDefaultFieldsSchema } = require("./ticket");

const Schema = mongoose.Schema;

const ticketTemplateSchema = new Schema(
  {
    ...ticketDefaultFieldsSchema.obj,
    sharedCompanies: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "Company",
        },
        alias: {
          type: String,
        },
      },
    ],
    sharedUsers: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        firstName: String,
        lastName: String,
      },
    ],
    createdBy: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      firstName: String,
      lastName: String,
    },
    updatedBy: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      firstName: String,
      lastName: String,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("TicketTemplate", ticketTemplateSchema);

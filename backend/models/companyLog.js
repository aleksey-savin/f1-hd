const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const companyLogSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
    activeDirectoryObjectGUID: {
      type: String,
      required: true,
    },
    activeDirectoryLogin: {
      type: String,
      required: true,
    },
    computerName: {
      type: String,
      required: false,
    },
    action: {
      type: String,
      enum: ["userLogin"],
      required: true,
      default: "userLogin",
    },
  },
  { timestamps: true },
);

// Индекс для быстрого поиска по компании и времени
companyLogSchema.index({ companyId: 1, createdAt: -1 });

// Индекс для поиска по GUID Active Directory
companyLogSchema.index({ activeDirectoryObjectGUID: 1 });

// Индекс для поиска по связанному пользователю
companyLogSchema.index({ userId: 1 });

const CompanyLog = mongoose.model("CompanyLog", companyLogSchema);

module.exports = CompanyLog;

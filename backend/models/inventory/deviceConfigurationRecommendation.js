const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceConfigurationRecommendationSchema = new Schema(
  {
    deviceConfigurationId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceConfiguration",
      required: true,
    },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },
    comment: {
      type: String,
      required: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

const DeviceConfigurationRecommendation = mongoose.model(
  "DeviceConfigurationRecommendation",
  deviceAttributeSchema,
);

module.exports = DeviceConfigurationRecommendation;

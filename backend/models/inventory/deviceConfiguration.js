const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceConfigurationSchema = new Schema(
  {
    name: {
      type: String,
      required: false,
    },
    description: {
      type: String,
      required: false,
    },
    deviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceType",
      required: true,
    },
    values: [
      {
        attributeId: { type: Schema.Types.ObjectId, ref: "DeviceAttribute" },
        value: String,
      },
    ],
    deletedAt: Date,
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
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

const DeviceConfiguration = mongoose.model(
  "DeviceConfiguration",
  deviceConfigurationSchema,
);

module.exports = DeviceConfiguration;

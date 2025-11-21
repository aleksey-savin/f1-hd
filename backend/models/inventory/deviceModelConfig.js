const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceModelConfigSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
    },
    companiesIds: [{ type: Schema.Types.ObjectId, ref: "Company" }],
    deviceModelsIds: [{ type: Schema.Types.ObjectId, ref: "DeviceModel" }],
    ram: {
      type: String,
      trim: true,
    },
    storage: {
      type: String,
      trim: true,
    },
    processor: {
      type: String,
      trim: true,
    },
    graphics: {
      type: String,
      trim: true,
    },
    ports: {
      type: String,
      trim: true,
    },
    powerSupply: {
      type: String,
      trim: true,
    },
    screenSize: {
      type: String,
      trim: true,
    },
    additionalSpecs: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },

    // Audit fields
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

    // Soft delete
    deletedAt: Date,
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

const DeviceModelConfig = mongoose.model(
  "DeviceModelConfig",
  deviceModelConfigSchema,
);

module.exports = DeviceModelConfig;

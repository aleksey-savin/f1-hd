const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceModelSchema = new Schema(
  {
    deviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceType",
      required: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    name: {
      type: String,
      required: false,
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
  { timestamps: true },
);

const DeviceModel = mongoose.model("DeviceModel", deviceModelSchema);

module.exports = DeviceModel;

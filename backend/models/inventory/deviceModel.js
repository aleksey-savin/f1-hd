const mongoose = require("mongoose");

const devicePhotoSchema = require("./devicePhoto");

const Schema = mongoose.Schema;

const deviceModelSchema = new Schema(
  {
    name: {
      type: String,
      required: false,
      trim: true,
    },
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
    compatibleWithModelIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "DeviceModel",
      },
    ],
    notes: {
      type: String,
      trim: true,
    },
    // Каталожные снимки модели: их наследуют все экземпляры без собственных фото.
    photos: [devicePhotoSchema],

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

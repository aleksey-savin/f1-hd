const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Сборка — шаблон «своего» ПК: набор моделей деталей по слотам типа.
// Не модель каталога (модели — только заводские).
const deviceBuildSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    deviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceType",
      required: true,
    },
    parts: [
      {
        _id: false,
        typeId: { type: Schema.Types.ObjectId, ref: "DeviceType", required: true },
        deviceModelId: {
          type: Schema.Types.ObjectId,
          ref: "DeviceModel",
          required: true,
        },
        configurationId: {
          type: Schema.Types.ObjectId,
          ref: "DeviceConfiguration",
          default: null,
        },
        quantity: { type: Number, min: 1, default: 1 },
      },
    ],
    notes: { type: String, trim: true },
    deletedAt: Date,
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: false },
  },
  { timestamps: true },
);

deviceBuildSchema.index({ deviceTypeId: 1, deletedAt: 1 });

const DeviceBuild = mongoose.model("DeviceBuild", deviceBuildSchema);

module.exports = DeviceBuild;

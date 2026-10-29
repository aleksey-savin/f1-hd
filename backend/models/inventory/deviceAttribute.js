const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceAttributeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    valueType: {
      type: String,
      enum: ["string", "number", "boolean", "select", "multiselect", "text", "date"],
      required: true,
      default: "string",
    },
    // Уровень: «model» — значение в конфигурации модели, «device» — своё у
    // каждого экземпляра (ClientDevice.attributes). См. services/inventory/attributeScope.js
    scope: {
      type: String,
      enum: ["model", "device"],
      default: "model",
    },
    unit: {
      type: String,
      trim: true,
    },
    options: [
      {
        value: String,
        label: String,
      },
    ], // Для select/multiselect
    isActive: {
      type: Boolean,
      default: true,
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

const DeviceAttribute = mongoose.model(
  "DeviceAttribute",
  deviceAttributeSchema,
);

module.exports = DeviceAttribute;

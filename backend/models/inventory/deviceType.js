const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceTypeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isComponent: {
      type: Boolean,
      default: false,
    },
    isConsumable: {
      type: Boolean,
      default: false,
    },
    // Префикс для автогенерации инвентарных номеров активов этого типа
    // (напр. "СБ" → "СБ-000001"). Пусто — используется дефолтный префикс.
    inventoryPrefix: {
      type: String,
      trim: true,
      uppercase: true,
    },
    configurationIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "DeviceConfiguration",
      },
    ],
    attachableToTypeIds: [{ type: Schema.Types.ObjectId, ref: "DeviceType" }],
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

const DeviceType = mongoose.model("DeviceType", deviceTypeSchema);

module.exports = DeviceType;

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
    // Периферия (мышь, клавиатура, монитор, внешний адаптер) — наряду с
    // комплектующими/расходниками может прикрепляться к сборке как компонент.
    isPeripheral: {
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
    // «Своя сборка» на типе: слоты (типы комплектующих) и ключевые
    // характеристики. Действует только на устройства «Своя сборка» этого типа;
    // порядок — порядок массивов.
    assembly: {
      enabled: { type: Boolean, default: false },
      slots: [
        {
          _id: false,
          typeId: { type: Schema.Types.ObjectId, ref: "DeviceType" },
          required: { type: Boolean, default: false },
          multiple: { type: Boolean, default: false },
        },
      ],
      keySpecs: [
        {
          _id: false,
          typeId: { type: Schema.Types.ObjectId, ref: "DeviceType" },
          source: { type: String, enum: ["model", "attribute"] },
          attributeId: {
            type: Schema.Types.ObjectId,
            ref: "DeviceAttribute",
            default: null,
          },
          aggregate: { type: String, enum: ["first", "sum", "list"] },
        },
      ],
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

const DeviceType = mongoose.model("DeviceType", deviceTypeSchema);

module.exports = DeviceType;

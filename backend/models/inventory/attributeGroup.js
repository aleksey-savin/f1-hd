const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Группа атрибутов каталога («Процессор», «Оперативная память»…): подзаголовок
// в спецификации типа. Связка атрибута типа ссылается на неё через groupId.
const attributeGroupSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
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

// Имя уникально без учёта регистра
attributeGroupSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "ru", strength: 2 } },
);

const AttributeGroup = mongoose.model("AttributeGroup", attributeGroupSchema);

module.exports = AttributeGroup;

const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const supplierSchema = new Schema(
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
    // Контакты — всё необязательное: поставщик заводится одним названием на
    // бегу, из мастера устройства. Дописывают их, когда доходит до гарантии.
    phone: { type: String, trim: true },
    email: { type: String, trim: true },
    website: { type: String, trim: true },
    address: { type: String, trim: true },
    // Реквизиты отдельными полями — их сверяют с бухгалтерией, и искать их
    // в свободных заметках пришлось бы глазами.
    inn: { type: String, trim: true },
    kpp: { type: String, trim: true },
    // Условия, договор, менеджер — всё, что не легло в поля.
    notes: { type: String, trim: true },
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

const Supplier = mongoose.model("Supplier", supplierSchema);

module.exports = Supplier;

const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceAttributeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    dataType: {
      type: String,
      enum: ["string", "number", "boolean", "select", "multiselect", "text"],
      required: true,
      default: "string",
    },
    unit: {
      type: String,
      trim: true, // GB, MHz, inches, W и т.д.
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
    displayOrder: {
      type: Number,
      default: 0,
    },

    // Audit fields
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

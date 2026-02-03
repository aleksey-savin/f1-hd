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
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    attributes: [
      {
        attributeId: {
          type: Schema.Types.ObjectId,
          ref: "DeviceAttribute",
          required: true,
        },
        isRequired: {
          type: Boolean,
          default: false,
        },
        defaultValue: Schema.Types.Mixed,
        displayOrder: {
          type: Number,
          default: 0,
        },
        _id: false,
      },
    ],
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

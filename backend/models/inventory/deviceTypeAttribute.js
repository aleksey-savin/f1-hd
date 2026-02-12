const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceTypeAttributeSchema = new Schema(
  {
    deviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceType",
      required: true,
    },
    attributeId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceAttribute",
      required: true,
    },
    required: {
      type: Boolean,
      default: false,
    },
    extendable: {
      type: Boolean,
      default: false,
    },
    extendableFromIds: [
      {
        deviceTypeId: {
          type: Schema.Types.ObjectId,
          ref: "DeviceType",
          required: true,
        },
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

const DeviceTypeAttribute = mongoose.model(
  "DeviceTypeAttribute",
  deviceTypeAttributeSchema,
);

module.exports = DeviceTypeAttribute;

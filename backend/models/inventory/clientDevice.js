const mongoose = require("mongoose");

const clientDeviceSchema = new mongoose.Schema(
  {
    company: {
      type: String,
      required: true,
    },
    user: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    deviceType: {
      type: String,
      required: true,
    },
    manufacturer: {
      type: String,
      required: true,
      trim: true,
    },
    model: {
      type: String,
      required: true,
      trim: true,
    },
    serialNumber: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    purchaseDate: {
      type: Date,
    },
    price: {
      type: Number,
    },
    purchaseDocument: {
      type: String,
    },
    warrantyExpirationDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["Готово к выдаче", "Выдано", "В ремонте", "Списано"],
      default: "Готово к выдаче",
    },
    lastMaintenanceDate: {
      type: Date,
    },
    notes: {
      type: String,
      trim: true,
    },
    assignedTo: {
      type: String,
      trim: true,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    macAddress: {
      type: String,
      trim: true,
    },
    operatingSystem: {
      type: String,
    },
  },
  { timestamps: true },
);

const ClientDevice = mongoose.model("ClientDevice", clientDeviceSchema);

module.exports = ClientDevice;

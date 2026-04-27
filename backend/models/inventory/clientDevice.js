const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const clientDeviceSchema = new Schema(
  {
    configurationId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceConfiguration",
    },
    deviceModelId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceModel",
    },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
    },
    comment: {
      type: String,
      required: false,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
    },
    serialNumber: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    // Purchase and warranty information
    purchasedAt: {
      type: Date,
    },
    price: {
      type: Number,
      min: 0,
    },
    purchaseDocument: {
      type: String,
      trim: true,
    },
    warrantyExpirationDate: {
      type: Date,
    },

    // Device status and lifecycle
    status: {
      type: String,
      enum: [
        "readyForDeployment",
        "deployed",
        "inRepair",
        "decommissioned",
        "inReserve",
        "disposed",
      ],
      default: "readyForDeployment",
    },

    // Maintenance information
    lastMaintenanceDate: {
      type: Date,
    },
    nextMaintenanceDate: {
      type: Date,
    },
    maintenanceInterval: {
      type: Number, // days
      default: 365,
    },

    // Technical specifications
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
      trim: true,
    },
    inventoryNumber: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    installedSoftware: [
      {
        name: String,
        version: String,
        licenseKey: String,
        installedDate: Date,
      },
    ],
    // Lifecycle tracking
    deploymentDate: {
      type: Date,
    },
    retirementDate: {
      type: Date,
    },
    expectedLifespan: {
      type: Number, // months
      default: 36,
    },

    // Financial information
    depreciationRate: {
      type: Number, // percentage per year
      default: 33.33,
    },
    currentValue: {
      type: Number,
      default: function () {
        return this.price;
      },
    },

    // Import/migration tracking
    importSource: {
      type: String,
      enum: ["manual", "csv_import", "api_import", "migration"],
      default: "manual",
    },
    importDate: Date,

    // Audit fields
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

    // Soft delete
    deletedAt: Date,
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    // Add version key for optimistic concurrency control
    versionKey: "__v",
  },
);

const ClientDevice = mongoose.model("ClientDevice", clientDeviceSchema);

module.exports = ClientDevice;

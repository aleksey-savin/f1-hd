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
    // Прямой тип устройства — для самосборной техники без модели/вендора
    // (для брендовых устройств тип берётся из deviceModelId).
    deviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: "DeviceType",
    },
    // Родительская сборка — для комплектующих (системник → CPU/ОЗУ/…).
    // У самостоятельных устройств отсутствует; такие исключаются из общего списка.
    parentDeviceId: {
      type: Schema.Types.ObjectId,
      ref: "ClientDevice",
    },
    // Количество (для комплектующих: напр. 2×16 ГБ ОЗУ).
    quantity: {
      type: Number,
      default: 1,
      min: 1,
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
    // Серийный номер опционален: у самосборной техники его нет. Уникальность
    // обеспечивает партиал-индекс ниже (только для реально заданных строк).
    serialNumber: {
      type: String,
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
    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
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

// Партиал-уникальные индексы: ограничение действует только для документов, где
// поле реально присутствует строкой. Отсутствующие (unset) значения в индекс не
// попадают, поэтому много активов без серийника/инв.номера сосуществуют.
clientDeviceSchema.index(
  { serialNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { serialNumber: { $type: "string" } },
  },
);
clientDeviceSchema.index(
  { inventoryNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { inventoryNumber: { $type: "string" } },
  },
);
// Быстрая выборка комплектующих сборки.
clientDeviceSchema.index({ parentDeviceId: 1 });

const ClientDevice = mongoose.model("ClientDevice", clientDeviceSchema);

module.exports = ClientDevice;

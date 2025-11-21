const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const deviceResponsibilitySchema = new Schema(
  {
    device: {
      type: Schema.Types.ObjectId,
      ref: "ClientDevice",
      required: true,
    },
    responsibleUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    responsibilityType: {
      type: String,
      enum: [
        "primary_user",        // Основной пользователь устройства
        "subdivision_manager", // Руководитель подразделения
        "location_manager",    // Ответственный за расположение
        "it_admin",           // IT-администратор
        "manual_assignment"   // Ручное назначение
      ],
      required: true,
    },
    assignmentReason: {
      type: String,
      enum: [
        "device_assignment",   // При назначении устройства
        "location_change",     // При смене расположения
        "user_transfer",       // При переводе пользователя
        "manual_override",     // Ручное переопределение
        "subdivision_change",  // При смене подразделения
        "role_change",        // При смене роли пользователя
        "device_type_rule"    // По правилам типа устройства
      ],
      required: true,
    },

    // Дополнительная информация об ответственности
    permissions: {
      canUse: { type: Boolean, default: true },
      canTransfer: { type: Boolean, default: false },
      canMaintain: { type: Boolean, default: false },
      canDispose: { type: Boolean, default: false },
    },

    // Временные рамки ответственности
    startDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    endDate: {
      type: Date,
      required: false, // null означает активную ответственность
    },

    // Условия автоматического завершения ответственности
    autoEndConditions: {
      onLocationChange: { type: Boolean, default: false },
      onUserTransfer: { type: Boolean, default: true },
      onDeviceTransfer: { type: Boolean, default: true },
    },

    // Статус ответственности
    isActive: {
      type: Boolean,
      default: true,
    },
    isPrimary: {
      type: Boolean,
      default: false, // Только один primary ответственный на устройство
    },

    // Подтверждение ответственности
    acknowledgment: {
      isAcknowledged: { type: Boolean, default: false },
      acknowledgedAt: Date,
      acknowledgedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      acknowledgmentMethod: {
        type: String,
        enum: ["email", "system", "manual", "auto"],
        default: "system",
      },
    },

    // Инвентаризация
    lastInventoryCheck: {
      date: Date,
      performedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      status: {
        type: String,
        enum: ["confirmed", "missing", "damaged", "needs_replacement"],
      },
      notes: String,
    },

    // Заметки и комментарии
    notes: {
      type: String,
      required: false,
    },
    transferNotes: {
      type: String,
      required: false,
    },

    // Метаданные для аудита
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    endedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Индексы для производительности
deviceResponsibilitySchema.index({ device: 1, isActive: 1 });
deviceResponsibilitySchema.index({ responsibleUser: 1, isActive: 1 });
deviceResponsibilitySchema.index({ device: 1, isPrimary: 1, isActive: 1 });
deviceResponsibilitySchema.index({ startDate: 1, endDate: 1 });
deviceResponsibilitySchema.index({ "lastInventoryCheck.date": 1 });

// Уникальный индекс для предотвращения дублирования primary ответственности
deviceResponsibilitySchema.index(
  { device: 1, isPrimary: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isPrimary: true, isActive: true }
  }
);

// Валидация перед сохранением
deviceResponsibilitySchema.pre("save", async function (next) {
  try {
    // Проверяем, что у устройства только один primary ответственный
    if (this.isPrimary && this.isActive) {
      const existingPrimary = await this.constructor.findOne({
        device: this.device,
        isPrimary: true,
        isActive: true,
        _id: { $ne: this._id }
      });

      if (existingPrimary) {
        const error = new Error("Device can have only one primary responsible user");
        return next(error);
      }
    }

    // Если устанавливается endDate, деактивируем ответственность
    if (this.endDate && this.isActive) {
      this.isActive = false;
    }

    // Если это новая запись и нет других ответственных, делаем её primary
    if (this.isNew) {
      const existingResponsibilities = await this.constructor.countDocuments({
        device: this.device,
        isActive: true
      });

      if (existingResponsibilities === 0) {
        this.isPrimary = true;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Метод для завершения ответственности
deviceResponsibilitySchema.methods.endResponsibility = async function(endedBy, reason, notes) {
  this.endDate = new Date();
  this.isActive = false;
  this.endedBy = endedBy;
  this.transferNotes = notes;

  await this.save();

  // Если это была primary ответственность, нужно назначить новую
  if (this.isPrimary) {
    const nextResponsible = await this.constructor.findOne({
      device: this.device,
      isActive: true,
      _id: { $ne: this._id }
    }).sort({ createdAt: 1 });

    if (nextResponsible) {
      nextResponsible.isPrimary = true;
      await nextResponsible.save();
    }
  }
};

// Метод для подтверждения ответственности
deviceResponsibilitySchema.methods.acknowledge = async function(acknowledgedBy, method = "manual") {
  this.acknowledgment.isAcknowledged = true;
  this.acknowledgment.acknowledgedAt = new Date();
  this.acknowledgment.acknowledgedBy = acknowledgedBy;
  this.acknowledgment.acknowledgmentMethod = method;

  await this.save();
};

// Метод для обновления инвентаризации
deviceResponsibilitySchema.methods.updateInventoryCheck = async function(performedBy, status, notes) {
  this.lastInventoryCheck = {
    date: new Date(),
    performedBy,
    status,
    notes
  };

  await this.save();
};

// Статический метод для получения текущего primary ответственного за устройство
deviceResponsibilitySchema.statics.getPrimaryResponsible = async function(deviceId) {
  return await this.findOne({
    device: deviceId,
    isPrimary: true,
    isActive: true
  }).populate("responsibleUser", "firstName lastName email");
};

// Статический метод для получения всех активных ответственных за устройство
deviceResponsibilitySchema.statics.getActiveResponsibilities = async function(deviceId) {
  return await this.find({
    device: deviceId,
    isActive: true
  })
  .populate("responsibleUser", "firstName lastName email")
  .sort({ isPrimary: -1, createdAt: 1 });
};

// Статический метод для получения устройств пользователя
deviceResponsibilitySchema.statics.getUserDevices = async function(userId, includeSecondary = false) {
  const query = {
    responsibleUser: userId,
    isActive: true
  };

  if (!includeSecondary) {
    query.isPrimary = true;
  }

  return await this.find(query)
    .populate("device")
    .sort({ isPrimary: -1, createdAt: -1 });
};

// Статический метод для создания ответственности
deviceResponsibilitySchema.statics.createResponsibility = async function(data) {
  const responsibility = new this(data);
  await responsibility.save();
  return responsibility;
};

// Статический метод для передачи ответственности
deviceResponsibilitySchema.statics.transferResponsibility = async function(
  deviceId,
  fromUserId,
  toUserId,
  transferredBy,
  reason = "manual_override",
  notes = ""
) {
  // Завершаем старую ответственность
  const oldResponsibility = await this.findOne({
    device: deviceId,
    responsibleUser: fromUserId,
    isPrimary: true,
    isActive: true
  });

  if (oldResponsibility) {
    await oldResponsibility.endResponsibility(transferredBy, reason, notes);
  }

  // Создаем новую ответственность
  const newResponsibility = await this.createResponsibility({
    device: deviceId,
    responsibleUser: toUserId,
    responsibilityType: "manual_assignment",
    assignmentReason: reason,
    isPrimary: true,
    notes: notes,
    createdBy: transferredBy
  });

  return newResponsibility;
};

const DeviceResponsibility = mongoose.model("DeviceResponsibility", deviceResponsibilitySchema);

module.exports = DeviceResponsibility;

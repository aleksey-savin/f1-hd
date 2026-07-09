const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Фотография устройства или его модели: `name` — ключ объекта в S3, он же путь
// для публичного резолвера /uploads/<name>. `originalName` показывается
// пользователю. Одна схема на обе сущности — снимки живут по одним правилам.
const devicePhotoSchema = new Schema(
  {
    name: { type: String, required: true },
    originalName: String,
    mimetype: String,
    size: Number,
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: { createdAt: "uploadedAt", updatedAt: false } },
);

module.exports = devicePhotoSchema;

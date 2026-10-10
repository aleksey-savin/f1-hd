const mongoose = require("mongoose");

// Общий счётчик проекта (коллекция counters): _id — имя счётчика, seq — значение.
// Регистрация с защитой от повтора: порядок загрузки моделей не важен.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

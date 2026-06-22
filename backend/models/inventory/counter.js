const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Атомарный счётчик последовательностей для инвентарных номеров (по одному
// счётчику на префикс). Имя "InventoryCounter" — отдельно от модели "Counter"
// из ticket.js (номера тикетов), чтобы не делить коллекцию и не конфликтовать.
const counterSchema = new Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

// Атомарно инкрементит и возвращает следующее значение последовательности.
// upsert: первый вызов для нового ключа создаёт счётчик со значением 1.
counterSchema.statics.getNextSequence = async function (key) {
  const counter = await this.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return counter.seq;
};

// Guard от повторной регистрации (на случай двойного require).
const Counter =
  mongoose.models.InventoryCounter ||
  mongoose.model("InventoryCounter", counterSchema);

module.exports = Counter;

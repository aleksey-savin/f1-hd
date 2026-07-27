const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const subdivisionSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: false,
    },
    phone: {
      type: String,
      required: false,
    },
    address: {
      type: String,
      required: false,
    },
    linkToMap: {
      type: String,
      required: false,
    },
    // Часовой пояс филиала (IANA). null — наследуется по цепочке
    // родитель → компания → Preferences.timezone (см. services/clientTimezone).
    // Без него техподдержка звонила главбуху филиала в его 3 часа ночи.
    timezone: {
      type: String,
      default: null,
    },
    company: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    manager: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    users: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    parent: {
      type: Schema.Types.ObjectId,
      ref: "Subdivision",
    },
    subdivisions: [
      {
        type: Schema.Types.ObjectId,
        ref: "Subdivision",
      },
    ],
  },
  { timestamps: true },
);

// Подразделения всегда выбираются либо целиком по компании (дерево карточки,
// скоуп отчёта), либо по руководителю (доступ руководителя филиала к отчёту).
// Индексов у коллекции не было вовсе — оба запроса шли коллсканом.
subdivisionSchema.index({ company: 1 });
subdivisionSchema.index({ manager: 1 });

// Initialize arrays if they're undefined
subdivisionSchema.pre("save", function (next) {
  if (!this.users) {
    this.users = [];
  }
  if (!this.subdivisions) {
    this.subdivisions = [];
  }
  next();
});

const Subdivision = mongoose.model("Subdivision", subdivisionSchema);

module.exports = Subdivision;

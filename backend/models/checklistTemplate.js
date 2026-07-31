const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Шаблон чек-листа — готовый список с привязками к категориям заявок и
 * компаниям.
 *
 * Зачем: чек-лист есть у 3 % заявок, и 96 % из них приезжают из регламента;
 * руками за год завели четыре штуки. Значит вопрос не в удобстве редактора, а в
 * том, чтобы список приезжал готовым в заявки, которые создают вручную (90,5 %
 * всех). Отмечать инженеры готовы: там, где список есть, отмечено 96,3 %
 * пунктов.
 *
 * Привязки задают УЗОСТЬ, по которой шаблон выигрывает подбор (правило целиком —
 * services/checklistTemplates.js). Шаблон без привязок автоматически не
 * применяется никогда: один такой повесился бы на все заявки подряд.
 *
 * Форма пункта — та же, что у чек-листа заявки, шаблона заявки и регламента
 * (`description` + `mandatory`): список один, редактор один (app/Checklist).
 */
const checklistTemplateSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    items: [
      {
        _id: false,
        description: String,
        mandatory: { type: Boolean, default: false },
      },
    ],
    // Пусто = «все категории»: такой шаблон в автоподборе не участвует
    categories: [
      {
        type: Schema.Types.ObjectId,
        ref: "TicketCategory",
      },
    ],
    // Пусто = «все компании»
    companies: [
      {
        type: Schema.Types.ObjectId,
        ref: "Company",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      _id: { type: Schema.Types.ObjectId, ref: "User" },
      firstName: String,
      lastName: String,
    },
    updatedBy: {
      _id: { type: Schema.Types.ObjectId, ref: "User" },
      firstName: String,
      lastName: String,
    },
  },
  { timestamps: true },
);

// Подбор идёт по категории заявки и её компании
checklistTemplateSchema.index({ isActive: 1, categories: 1 });
checklistTemplateSchema.index({ isActive: 1, companies: 1 });

module.exports = mongoose.model("ChecklistTemplate", checklistTemplateSchema);

const ChecklistTemplate = require("@/models/checklistTemplate");
const Preferences = require("@/models/preferences");

/**
 * Подбор шаблона чек-листа под заявку — единственное место, где живёт правило
 * «побеждает самый узкий».
 *
 * Один код на три потребителя: автоприменение при создании заявки, список «Ещё
 * чек-листы» на карточке и счётчик «Взять шаблон · N» в редакторе. Вторая копия
 * правила разъехалась бы с первой на первом же краевом случае.
 *
 * Порядок узости (чем меньше rank, тем уже):
 *   1 — категория И компания   «у этого клиента своя почта»
 *   2 — только компания        «у клиента свой порядок приёмки»
 *   3 — только категория       основной случай
 *   — без привязок             в автоподбор НЕ входит вовсе
 *
 * Ничьих не бывает: на одном уровне выигрывает более ранний по названию, а
 * второй остаётся в списке «Ещё». Склеивать два списка нельзя — получится каша
 * из девяти пунктов, которую никто не отметит.
 */

const idOf = (value) => String(value?._id ?? value ?? "");

/** Ранг узости или null, если шаблон к заявке не относится. */
const rankFor = (template, { categoryId, companyId }) => {
  const categories = (template.categories || []).map(idOf);
  const companies = (template.companies || []).map(idOf);

  const boundToCategory = categories.length > 0;
  const boundToCompany = companies.length > 0;

  // Без привязок — только ручной выбор
  if (!boundToCategory && !boundToCompany) {
    return null;
  }
  if (boundToCategory && !categories.includes(String(categoryId))) {
    return null;
  }
  if (boundToCompany && !companies.includes(String(companyId))) {
    return null;
  }

  if (boundToCategory && boundToCompany) return 1;
  if (boundToCompany) return 2;
  return 3;
};

/**
 * Шаблоны для заявки: подходящие (с рангом, отсортированные от узкого к
 * общему) и остальные активные — их выбирают руками, когда автоподбор промахнулся.
 *
 * @returns {{ matched: Array, others: Array }}
 */
const templatesForTicket = async (ticket) => {
  const templates = await ChecklistTemplate.find({ isActive: true })
    .sort({ title: 1 })
    .lean();

  const context = {
    categoryId: idOf(ticket?.categoryId),
    companyId: idOf(ticket?.company?._id ?? ticket?.company),
  };

  const matched = [];
  const others = [];

  for (const template of templates) {
    const rank = rankFor(template, context);
    if (rank) {
      matched.push({ ...template, rank });
    } else {
      others.push(template);
    }
  }

  matched.sort((left, right) => left.rank - right.rank);

  return { matched, others };
};

/** Победивший шаблон или null. */
const bestTemplateForTicket = async (ticket) => {
  const { matched } = await templatesForTicket(ticket);
  return matched[0] || null;
};

/** Включено ли автоприменение (глобальная настройка, одна на всё приложение). */
const autoApplyEnabled = async () => {
  const preferences = await Preferences.findOne({})
    .select("checklistTemplates")
    .lean();
  return Boolean(preferences?.checklistTemplates?.autoApply);
};

/**
 * Чек-лист заявки из шаблона: отметок у нового списка нет, форма пункта та же,
 * что у заявки.
 */
const itemsToChecklist = (template) =>
  (template?.items || []).map((item) => ({
    description: item.description,
    mandatory: !!item.mandatory,
    checked: false,
  }));

module.exports = {
  rankFor,
  templatesForTicket,
  bestTemplateForTicket,
  autoApplyEnabled,
  itemsToChecklist,
};

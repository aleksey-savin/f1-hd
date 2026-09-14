const AiFeedback = require("@/models/aiFeedback");
const logger = require("@/utils/logger");
const { aiFeatureEnabled } = require("@/services/ai/features");

// Замечания сотрудников, доросшие до правил, подмешиваются в промпты.
//
// Правило приходит из живой ошибки: кто-то увидел, что ИИ подобрал не ту
// категорию или переврал итог звонка, нажал на метку и объяснил, как правильно.
// Пока администратор такое замечание не включит, в промпт оно не попадает —
// иначе одна эмоциональная формулировка тихо испортит генерации всему отделу.
//
// Область у правила всегда есть: категория заявки или её компания. Общие
// наставления модели живут в самом промпте, а не здесь.
const MAX_RULES = 8;

/**
 * @returns {Promise<Array>} активные правила, свежие первыми
 */
exports.collectRules = async ({ categoryId, companyId } = {}) => {
  const scope = [];
  if (categoryId) scope.push({ "category._id": categoryId });
  if (companyId) scope.push({ "company._id": companyId });
  if (!scope.length) return [];

  try {
    return await AiFeedback.find({ isActive: true, $or: scope })
      .select("text target category company updatedAt")
      .sort({ updatedAt: -1 })
      .limit(MAX_RULES)
      .lean();
  } catch (error) {
    // Правила — приправа, а не блюдо: их недоступность не повод отменять ответ
    logger.log("warn", "Failed to load AI rules", { error: error.message });
    return [];
  }
};

/**
 * Хвост промпта с правилами. Пустая строка, если правил нет, — тогда промпт
 * остаётся ровно таким, каким его написали.
 */
exports.buildRulesBlock = (rules = []) => {
  const lines = rules
    .map((rule) => String(rule.text || "").trim())
    .filter(Boolean)
    .map((text) => `- ${text}`);

  if (!lines.length) return "";

  return (
    "\n\nЗамечания сотрудников по прошлым ответам в этой области — учти их и не повторяй разобранных ошибок:\n" +
    lines.join("\n")
  );
};

/**
 * Короткий путь: собрать и сразу оформить. Функция «Замечания к ИИ» выключена в
 * настройках — правила в запросы не идут, хотя и остаются в списке.
 */
exports.rulesFor = async (scope) => {
  if (!(await aiFeatureEnabled("feedback"))) return "";
  return exports.buildRulesBlock(await exports.collectRules(scope));
};

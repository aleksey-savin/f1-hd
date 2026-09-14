const Preferences = require("@/models/preferences");

/**
 * Функции ИИ, которые администратор включает по одной (Настройки → ИИ →
 * «Функции»).
 *
 * Главный рубильник `ai.isActive` — только подключение к модели: без него не
 * работает ни одна функция, включая расшифровку (у той свой канал и ключ, но
 * «ИИ выключен» обязан значить «выключено всё»). Флаг функции без рубильника
 * ничего не включает.
 *
 * Отсутствие флага = включено: до переключателей всё это работало от одного
 * `ai.isActive`, и старые установки не должны ничего потерять. Расшифровка
 * исключение — её рубильник был и раньше и по умолчанию выключен.
 *
 * Сводку отдаёт `/api/me` (`prefs.ai.features`), поэтому фронт читает готовое
 * булево и условия не повторяет.
 */
const AI_FEATURE_LABELS = {
  category: "Подбор категории",
  title: "Тема заявки по описанию",
  guide: "Руководство ИИ",
  terms: "Понятия в заявке",
  speechToText: "Расшифровка аудио",
  callSummary: "Описание из записи звонка",
  feedback: "Замечания к ИИ",
};

/**
 * @param {object} [ai] группа `ai` настроек (документ или lean-объект)
 * @returns {Record<keyof AI_FEATURE_LABELS, boolean>}
 */
const resolveAiFeatures = (ai) => {
  const on = Boolean(ai?.isActive);
  const flag = (value) => on && value !== false;
  const speech = on && Boolean(ai?.speechToText?.isActive);

  return {
    category: flag(ai?.features?.category),
    title: flag(ai?.features?.title),
    guide: flag(ai?.features?.guide),
    terms: flag(ai?.features?.terms),
    feedback: flag(ai?.features?.feedback),
    speechToText: speech,
    // Поверх расшифровки: без неё итога разговора нет
    callSummary: speech && ai?.speechToText?.callSummary !== false,
  };
};

/** Включена ли функция сейчас — читает настройки. */
const aiFeatureEnabled = async (feature) => {
  const prefs = await Preferences.findOne({}).lean();
  return resolveAiFeatures(prefs?.ai)[feature];
};

module.exports = { AI_FEATURE_LABELS, resolveAiFeatures, aiFeatureEnabled };

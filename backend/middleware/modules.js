const Preferences = require("@/models/preferences");
const {
  AI_FEATURE_LABELS,
  resolveAiFeatures,
} = require("@/services/ai/features");

/**
 * Рубильники модулей. Жили в `permissions.js`, но авторизацией не являются:
 * это настройка установки — «включён ли раздел вообще», — и от того, кто
 * пришёл, она не зависит. Вынесены, чтобы `permissions.js` остался файлом про
 * права.
 *
 * Читают синглтон `Preferences`. Отсутствие поля означает «выключено».
 */
const moduleGate = (path, message) => async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({});
    const enabled = path
      .split(".")
      .reduce((node, key) => (node == null ? node : node[key]), prefs);

    if (!enabled) {
      req.isAuth = false;
      return res.status(403).json({ error: true, status: 403, message });
    }
    next();
  } catch (error) {
    next(error);
  }
};

module.exports.timeTrackingModuleIsActive = moduleGate(
  "modules.timeTracking.isActive",
  'Модуль "Учёт времени" отключен.',
);
module.exports.inventoryModuleIsActive = moduleGate(
  "modules.inventory.isActive",
  'Модуль "Учёт техники" отключен.',
);
module.exports.mikrotikIsActive = moduleGate(
  "modules.mikrotik.isActive",
  'Модуль "Мониторинг Mikrotik" отключен.',
);
module.exports.financesModuleIsActive = moduleGate(
  "modules.finances.isActive",
  'Модуль "Финансы" отключен.',
);
module.exports.knowledgeBaseModuleIsActive = moduleGate(
  "modules.knowledgeBase.isActive",
  'Модуль "База знаний" отключен.',
);

/**
 * Функция ИИ по одной (Настройки → ИИ → «Функции»). Главный рубильник
 * `ai.isActive` учтён внутри: выключенный ИИ гасит каждую функцию.
 *
 * Проверка в самом клиенте ИИ (`aiService.generateJson`) остаётся, но она
 * срабатывает уже после того, как ручка пометила заявку «ожидает ИИ», — гейт
 * отказывает раньше и честно.
 */
module.exports.aiFeatureIsActive = (feature) => async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({}).lean();

    if (!resolveAiFeatures(prefs?.ai)[feature]) {
      req.isAuth = false;
      return res.status(403).json({
        error: true,
        status: 403,
        message: `Функция ИИ «${AI_FEATURE_LABELS[feature]}» выключена в настройках.`,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

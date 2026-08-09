const Preferences = require("@/models/preferences");

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
  "mikrotik.isActive",
  "Интеграция Mikrotik отключена.",
);
module.exports.financesModuleIsActive = moduleGate(
  "modules.finances.isActive",
  'Модуль "Финансы" отключен.',
);
module.exports.knowledgeBaseModuleIsActive = moduleGate(
  "modules.knowledgeBase.isActive",
  'Модуль "База знаний" отключен.',
);

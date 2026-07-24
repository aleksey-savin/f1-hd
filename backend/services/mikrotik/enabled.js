const Preferences = require("../../models/preferences");

// Единый рубильник интеграции Mikrotik (prefs.mikrotik.isActive): его читают
// кроны мониторинга (ранний выход), API гейтит middleware mikrotikIsActive,
// меню — preferences-initial. Отсутствие поля в старых документах = включено.
const mikrotikEnabled = async () => {
  const prefs = await Preferences.findOne({});
  return prefs?.mikrotik?.isActive !== false;
};

module.exports = { mikrotikEnabled };

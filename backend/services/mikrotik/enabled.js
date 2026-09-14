const Preferences = require("../../models/preferences");

// Рубильник модуля «Мониторинг Mikrotik» (prefs.modules.mikrotik): его читают
// кроны мониторинга (ранний выход), оверлей статуса на карточках инвентаря и
// авто-заявки; API гейтит middleware mikrotikIsActive, меню — /api/me.
const mikrotikEnabled = async () => {
  const prefs = await Preferences.findOne({}).lean();
  return Boolean(prefs?.modules?.mikrotik?.isActive);
};

module.exports = { mikrotikEnabled };

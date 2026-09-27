/**
 * «Модули» в настройках: состояние свитчей ↔ тело частичного POST
 * /api/preferences. Сервер ЗАМЕНЯЕТ объект modules целиком
 * (backend/controllers/preferences.js, ветка `has("modules")`): ключ, которого
 * нет в теле, выключается. Поэтому тело собирается из полного списка модулей,
 * а не из тех, что нарисованы. Чистые функции — тесты рядом:
 * `node --test src/components/Preferences/modules-payload.test.js`.
 */
export const MODULE_KEYS = [
  "messaging",
  "knowledgeBase",
  "timeTracking",
  "finances",
  "inventory",
  "mikrotik",
];

/** Свитчи из настроек: отсутствие ключа — «выключен». */
export const modulesFromPrefs = (prefsModules = {}) =>
  Object.fromEntries(
    MODULE_KEYS.map((key) => [key, Boolean(prefsModules?.[key]?.isActive)]),
  );

/** Тело сохранения: каждый модуль, финансы — только поверх учёта времени. */
export const modulesPayload = (modules) => ({
  modules: Object.fromEntries(
    MODULE_KEYS.map((key) => [
      key,
      {
        isActive:
          key === "finances"
            ? Boolean(modules.timeTracking && modules.finances)
            : Boolean(modules[key]),
      },
    ]),
  ),
});

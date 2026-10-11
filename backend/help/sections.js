/**
 * Разделы справки. Порядок в файле — порядок на странице.
 * `modules` — ключи Preferences.modules: раздел виден, если включён хотя бы
 * один. Раздел без статей читателю не показывается.
 * Как добавить статью — docs/help.md.
 */
module.exports = [
  { audience: "client", key: "start", title: "Начало работы" },
  { audience: "client", key: "tickets", title: "Заявки" },
  { audience: "client", key: "company", title: "Компания и сотрудники" },
  { audience: "client", key: "devices", title: "Устройства и рабочее место", modules: ["inventory"] },
  { audience: "client", key: "reports", title: "Отчёты и согласование работ", modules: ["timeTracking", "finances"] },
  { audience: "client", key: "knowledge", title: "База знаний", modules: ["knowledgeBase"] },
  { audience: "client", key: "account", title: "Аккаунт и уведомления" },

  { audience: "staff", key: "start", title: "Начало работы" },
  { audience: "staff", key: "tickets", title: "Заявки" },
  { audience: "staff", key: "conversations", title: "Диалоги", modules: ["messaging"] },
  { audience: "staff", key: "works", title: "Работы и время", modules: ["timeTracking"] },
  { audience: "staff", key: "reports", title: "Отчёты и согласование", modules: ["finances"] },
  { audience: "staff", key: "team", title: "Команда" },
  { audience: "staff", key: "companies", title: "Компании и пользователи" },
  { audience: "staff", key: "devices", title: "Устройства", modules: ["inventory"] },
  { audience: "staff", key: "knowledge", title: "База знаний", modules: ["knowledgeBase"] },
  { audience: "staff", key: "mikrotik", title: "Мониторинг Mikrotik", modules: ["mikrotik"] },
  { audience: "staff", key: "notifications", title: "Уведомления и Telegram" },
  { audience: "staff", key: "admin", title: "Администрирование" },
];

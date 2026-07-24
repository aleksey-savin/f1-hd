import { create } from "zustand";

// Дефолт статуса модерации базы знаний — чтобы компоненты не падали до загрузки
const defaultKnowledgeBase = {
  isModerator: false,
  hideNotApproved: false,
  scanForSecrets: false,
  approvalPeriodDays: 0,
  counts: {
    pendingApproval: 0,
    pendingDeletion: 0,
    pendingArchive: 0,
    secretsFlagged: 0,
  },
};

const useInitialPrefsStore = create((set) => ({
  contacts: "",
  getScreen: "",
  timezone: "",
  // Оператор такси («Основные → Такси»): "" — действие «такси» скрыто
  taxi: { operator: "" },
  emailNotifications: "",
  telegramNotifications: "",
  personalNotifications: "",
  modules: {
    inventory: { isActive: false },
    finances: { isActive: false },
    timeTracking: { isActive: false },
    knowledgeBase: { isActive: false },
  },
  // Интеграция Mikrotik — независима от модулей; питает пункты меню
  mikrotik: { isActive: false },
  ai: { isActive: false, speechToText: { isActive: false } },
  knowledgeBase: defaultKnowledgeBase,
  set: (data) =>
    set(() => ({
      contacts: data.contacts,
      getScreen: data.getScreen,
      timezone: data.timezone,
      taxi: data.taxi || { operator: "" },
      emailNotifications: data.emailNotifications,
      telegramNotifications: data.telegramNotifications,
      personalNotifications: data.personalNotifications,
      modules: data.modules,
      mikrotik: data.mikrotik || { isActive: false },
      ai: data.ai || { isActive: false, speechToText: { isActive: false } },
      knowledgeBase: data.knowledgeBase || defaultKnowledgeBase,
    })),
}));

export default useInitialPrefsStore;

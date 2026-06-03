import { create } from "zustand";

const useInitialPrefsStore = create((set) => ({
  contacts: "",
  getScreen: "",
  timezone: "",
  emailNotifications: "",
  telegramNotifications: "",
  personalNotifications: "",
  modules: {
    inventory: { isActive: false },
    finances: { isActive: false },
    timeTracking: { isActive: false },
  },
  ai: { isActive: false, speechToText: { isActive: false } },
  set: (data) =>
    set(() => ({
      contacts: data.contacts,
      getScreen: data.getScreen,
      timezone: data.timezone,
      emailNotifications: data.emailNotifications,
      telegramNotifications: data.telegramNotifications,
      personalNotifications: data.personalNotifications,
      modules: data.modules,
      ai: data.ai || { isActive: false, speechToText: { isActive: false } },
    })),
}));

export default useInitialPrefsStore;

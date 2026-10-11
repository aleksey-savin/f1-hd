import { create } from "zustand";

import {
  applyAccent,
  applyIcon,
  cacheBrand,
  mergeBrand,
  normalizeBrand,
  readCachedBrand,
} from "../util/brand.js";

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
  // Бренд инсталляции (название портала, акцент, значок). До ответа сервера —
  // с прошлой загрузки, чтобы название и цвет не мигали значениями по умолчанию
  brand: readCachedBrand(),
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
    mikrotik: { isActive: false },
    messaging: { isActive: false },
  },
  // Функции ИИ приходят из /api/me уже сведёнными с главным рубильником
  // (backend/services/ai/features.js): компонент читает одно булево
  ai: { isActive: false, features: {} },
  knowledgeBase: defaultKnowledgeBase,
  // Есть ли у читателя хоть одна видимая статья справки (ссылка в подвале)
  hasHelp: false,
  set: (data) =>
    set(() => ({
      brand: normalizeBrand(data.brand),
      contacts: data.contacts,
      getScreen: data.getScreen,
      timezone: data.timezone,
      taxi: data.taxi || { operator: "" },
      emailNotifications: data.emailNotifications,
      telegramNotifications: data.telegramNotifications,
      personalNotifications: data.personalNotifications,
      modules: data.modules,
      ai: data.ai || { isActive: false, features: {} },
      knowledgeBase: data.knowledgeBase || defaultKnowledgeBase,
      hasHelp: Boolean(data.hasHelp),
    })),
}));

/**
 * Принять бренд, как только он известен: с экранов входа (`preferences-auth`),
 * из загрузчика корня (`/api/me`) и после сохранения настроек. Кладёт его в
 * стор (название читают заголовок вкладки, марка и подвал), красит интерфейс,
 * обновляет значок вкладки и запоминает до следующей загрузки. Вызывается и
 * вне React — из загрузчиков маршрутов, до первой отрисовки.
 */
export const adoptBrand = (raw) => {
  const current = useInitialPrefsStore.getState().brand;
  const brand = mergeBrand(current, raw);
  const changed = Object.keys(brand).some((key) => brand[key] !== current[key]);
  if (changed) useInitialPrefsStore.setState({ brand });

  applyAccent(brand.accent);
  applyIcon(brand.icon);
  cacheBrand(brand);
  return brand;
};

export default useInitialPrefsStore;

import { create } from "zustand";

// Флаг «в Outlet сейчас отрисован errorElement». Root по нему кладёт контент
// на канву (как мигрированный маршрут) и прячет сайдбар — страница ошибок
// одна на обе UI-системы. Ставится layout-эффектом pages/Error.jsx.
const useRouteErrorStore = create((set) => ({
  active: false,
  setActive: (active) => set(() => ({ active })),
}));

export default useRouteErrorStore;

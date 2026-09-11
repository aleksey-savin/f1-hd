import { create } from "zustand";

import { load as loadFormData } from "@/store/form-data";

/**
 * Шаблоны заявок для главной — один набор на двух потребителей: блок карточек
 * (`components/Dashboard/TemplateTiles`) и подзаголовок страницы.
 *
 * Подзаголовку набор нужен целиком, а не для показа: «Выберите подходящий
 * запрос из списка» обещает список, а у клиента, которому не роздан ни один
 * шаблон, списка нет вовсе — обещание надо снять, а не подставить пустое место.
 *
 * Запрос не свой: тот же путь греет главная ради формы «Новая заявка»
 * (`store/form-data`), и второй такой же запрос был бы платой за те же данные.
 * Каталог правят редко, поэтому минута кэша здесь ничего не стоит.
 */
const useDashboardTemplatesStore = create((set) => ({
  templates: [],
  loaded: false,

  load: async () => {
    try {
      const templates = await loadFormData("/api/ticket-templates");
      set({ templates: Array.isArray(templates) ? templates : [] });
    } catch (error) {
      // Блок необязательный: не загрузился — остаётся карточка свободного
      // обращения, и заявку всё равно можно завести.
      console.error("Не удалось загрузить шаблоны заявок:", error);
    } finally {
      set({ loaded: true });
    }
  },
}));

export default useDashboardTemplatesStore;

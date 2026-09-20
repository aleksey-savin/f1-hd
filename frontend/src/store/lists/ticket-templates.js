import { create } from "zustand";

import { api } from "@/lib/api";
import { templateHasCompany } from "@/util/template-companies";

// Фильтр списка шаблонов заявок. Компания — одиночный фасет (чип-combobox в
// строке инструментов); категория / пользователи / автор — множественные (в
// шторке фильтра). Данные — из getAll (categoryId популирован, createdBy,
// sharedCompanies/sharedUsers, customFields, timestamps).
const templateFilter = (state) => {
  const originalList = state.originalList ?? [];

  return originalList
    .filter((item) => {
      if (!state.companies?.length) return true;
      return templateHasCompany(item, state.companies);
    })
    .filter((item) => {
      // Доступ: сотрудникам — allowAllStaff; клиентам — есть шеринг компаниям/
      // пользователям; личные — ничего из этого.
      if (state.access === "all") return true;
      const clients =
        (item.sharedCompanies?.length ?? 0) + (item.sharedUsers?.length ?? 0) >
        0;
      if (state.access === "staff") return !!item.allowAllStaff;
      if (state.access === "clients") return clients;
      if (state.access === "private") return !item.allowAllStaff && !clients;
      return true;
    })
    .filter((item) => {
      if (!state.categories?.length) return true;
      return state.categories.includes(item.categoryId?._id?.toString());
    })
    .filter((item) => {
      if (!state.sharedUsers?.length) return true;
      return (item.sharedUsers ?? []).some((user) =>
        state.sharedUsers.includes(user._id?.toString()),
      );
    })
    .filter((item) => {
      if (!state.authors?.length) return true;
      return state.authors.includes(item.createdBy?._id?.toString());
    })
    .filter((item) => {
      if (!state.searchTerm) return true;
      const haystack = [item.title, item.description, item.categoryId?.title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return state.searchTerm
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .every((term) => haystack.includes(term));
    });
};

// Сортировка применяется ко всем пересборкам filteredList: сервер отдаёт
// бинарный порядок mongo, без явной сортировки новый/изменённый шаблон встаёт
// не на место.
const sortList = (selected, list) => {
  if (!list?.length) return list;
  const sorted = [...list];
  switch (selected?.label) {
    case "По названию":
      sorted.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
      break;
    case "Сначала новые":
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case "Сначала старые":
      sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;
    default:
      break;
  }
  return sorted;
};

const useTicketTemplateFilterStore = create((set) => ({
  companies: [],
  access: "all",
  categories: [],
  sharedUsers: [],
  authors: [],
  searchTerm: "",
  sortingOptions: [
    { label: "По названию" },
    { label: "Сначала новые" },
    { label: "Сначала старые" },
  ],
  sortBy: { label: "По названию" },
  isSorting: false,
  handleSorting: async (data) => {
    set({ isSorting: true, sortBy: data });
    await new Promise((resolve) => setTimeout(resolve, 0));
    set((state) => ({
      sortBy: data,
      filteredList: sortList(data, state.filteredList),
      isSorting: false,
    }));
  },
  originalList: [],
  filteredList: [],
  fullTextSearch: (query) =>
    set((state) => ({
      searchTerm: query,
      filteredList: sortList(
        state.sortBy,
        templateFilter({ ...state, searchTerm: query }),
      ),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    try {
      const data = await api("/api/ticket-templates");
      set({ originalList: data, isLoading: false });
    } catch {
      // Пустой список вместо молчаливого зависания: до перехода на
      // api() ответ не проверялся вовсе, и на любой ошибке стор
      // оставался в isLoading навсегда.
      set({ originalList: [], isLoading: false });
    }
  },
  updateFilter: (data) =>
    set(() => ({
      companies: data.companies,
      access: data.access,
      categories: data.categories,
      sharedUsers: data.sharedUsers,
      authors: data.authors,
      searchTerm: data.searchTerm,
      originalList: data.originalList,
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({
      filteredList: sortList(state.sortBy, templateFilter(state)),
    })),
  resetFilter: () => {
    set(() => ({
      companies: [],
      access: "all",
      categories: [],
      sharedUsers: [],
      authors: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: sortList(state.sortBy, templateFilter(state)),
    }));
  },
}));

export default useTicketTemplateFilterStore;

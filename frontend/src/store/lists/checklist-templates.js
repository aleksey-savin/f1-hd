import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

// Стор справочника шаблонов чек-листов — по образцу «Вендоров»: поиск и
// сортировка на клиенте, шаблонов десятки, серверная выборка тут ничего не
// улучшит.

const searchItems = (query, items) => {
  if (!query) return items;
  const terms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fields = [
      item.title,
      ...(item.categories || []).map((category) => category.title),
      ...(item.companies || []).map((company) => company.alias),
      ...(item.items || []).map((entry) => entry.description),
    ];
    return terms.every((term) =>
      fields.some((field) => field && field.toLowerCase().includes(term)),
    );
  });
};

const sortList = (selected, list) => {
  if (!list?.length) return list;
  const sorted = [...list];

  switch (selected?.label) {
    case "По алфавиту":
      sorted.sort((a, b) => a.title.localeCompare(b.title, "ru"));
      break;
    case "Сначала новые":
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case "Больше пунктов":
      sorted.sort((a, b) => (b.items?.length ?? 0) - (a.items?.length ?? 0));
      break;
    default:
      break;
  }

  return sorted;
};

const useChecklistTemplateStore = create((set) => ({
  searchTerm: "",
  sortingOptions: [
    { label: "По алфавиту" },
    { label: "Сначала новые" },
    { label: "Больше пунктов" },
  ],
  sortBy: { label: "По алфавиту" },
  isSorting: false,
  handleSorting: async (data) => {
    set({ isSorting: true, sortBy: data });
    await new Promise((resolve) => setTimeout(resolve, 0));
    set((state) => ({
      filteredList: sortList(data, state.filteredList),
      isSorting: false,
    }));
  },
  originalList: [],
  filteredList: [],
  fullTextSearch: (query) =>
    set((state) => ({
      filteredList: sortList(
        state.sortBy,
        searchItems(query, state.originalList),
      ),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/checklist-templates`,
      { headers: { Authorization: "Bearer " + token } },
    );
    const data = await response.json();
    set({ originalList: data, isLoading: false });
  },
  applyFilter: () =>
    set((state) => ({
      filteredList: sortList(state.sortBy, state.originalList),
    })),
  resetFilter: () =>
    set((state) => ({
      searchTerm: "",
      filteredList: sortList(state.sortBy, state.originalList),
    })),
}));

export default useChecklistTemplateStore;

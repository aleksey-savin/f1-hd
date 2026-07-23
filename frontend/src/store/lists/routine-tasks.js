import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";
import { nextCronRuns } from "../../util/cron";

// Фильтр списка регламентов. Статус — сегмент (все/активные/пауза); категория и
// компания — множественные фасеты. Данные — из getAll (company/applicant/
// category денормализованы, cronSchedule, isActive, checklist, timestamps).
const routineFilter = (state) => {
  const list = state.originalList ?? [];

  return list
    .filter((item) => {
      if (!state.companies?.length) return true;
      return state.companies.includes(item.company?._id?.toString());
    })
    .filter((item) => {
      if (state.status === "active") return item.isActive;
      if (state.status === "paused") return !item.isActive;
      return true;
    })
    .filter((item) => {
      if (!state.categories?.length) return true;
      return state.categories.includes(item.category?._id?.toString());
    })
    .filter((item) => {
      if (!state.searchTerm) return true;
      const haystack = [
        item.title,
        item.description,
        item.company?.alias,
        item.category?.title,
        ...(item.checklist ?? []).map((c) => c.description),
      ]
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

const nextRunMs = (task) => {
  if (!task.isActive) return Infinity;
  const run = nextCronRuns(task.cronSchedule, 1)[0];
  return run ? run.getTime() : Infinity;
};

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
    case "Ближайший запуск":
      sorted.sort((a, b) => nextRunMs(a) - nextRunMs(b));
      break;
    default:
      break;
  }
  return sorted;
};

const useRoutineTaskFilterStore = create((set) => ({
  status: "all",
  categories: [],
  companies: [],
  searchTerm: "",
  sortingOptions: [
    { label: "Ближайший запуск" },
    { label: "По названию" },
    { label: "Сначала новые" },
    { label: "Сначала старые" },
  ],
  sortBy: { label: "Ближайший запуск" },
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
        routineFilter({ ...state, searchTerm: query }),
      ),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks`,
      { headers: { Authorization: "Bearer " + token } },
    );
    const data = await response.json();
    set({ originalList: Array.isArray(data) ? data : [], isLoading: false });
  },
  updateFilter: (data) =>
    set(() => ({
      status: data.status,
      categories: data.categories,
      companies: data.companies,
      searchTerm: data.searchTerm,
      originalList: data.originalList,
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({
      filteredList: sortList(state.sortBy, routineFilter(state)),
    })),
  resetFilter: () => {
    set(() => ({
      status: "all",
      categories: [],
      companies: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: sortList(state.sortBy, routineFilter(state)),
    }));
  },
}));

export default useRoutineTaskFilterStore;

import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";
import { getNextCronDate } from "../../util/time-helpers";

// функция последовательно отсеивает заявки согласно активным фильтрам
const taskFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList
    .filter((task) => {
      if (state.companies?.length > 0) {
        return state.companies.includes(task.company._id.toString());
      } else {
        return true;
      }
    })
    .filter((task) => {
      if (state.categories?.length > 0) {
        return state.categories.includes(task.category._id.toString());
      } else {
        return true;
      }
    })
    .filter((task) => {
      if (state.isActive) {
        return task.isActive;
      } else {
        return true;
      }
    })
    .filter((task) => {
      switch (state.checklist) {
        case "present":
          return task.checklist?.length > 0;
        case "abcent":
          return !task.checklist || task.checklist.length === 0;
        default:
          return true;
      }
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [
          item.title,
          item.description,
          item.company?.alias,
          item.category?.title,
          ...item.checklist.flatMap((checklistItem) => [
            checklistItem.description,
          ]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(state.searchTerm);
      } else {
        return true;
      }
    });
};

const searchItems = (query, items) => {
  if (!query) return items;

  // Split the query into individual terms (e.g., "Ольга Вознюк" becomes ["Ольга", "Вознюк"])
  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [
      item.title,
      item.description,
      item.company?.alias,
      item.category?.title,
      ...item.checklist.flatMap((checklistItem) => [checklistItem.description]),
    ];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term),
      ),
    );
  });
};

const handleSorting = (selected, list) => {
  if (!selected || !list.length) {
    return;
  }

  const sortedList = [...list];

  switch (selected.label) {
    case "По алфавиту":
      sortedList.sort((a, b) => a.title.localeCompare(b.title));
      break;

    case "Сначала новые":
      sortedList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;

    case "Сначала старые":
      sortedList.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;

    case "Следующая заявка":
      sortedList.sort(
        (a, b) =>
          new Date(getNextCronDate(a.cronSchedule)) -
          new Date(getNextCronDate(b.cronSchedule)),
      );
      break;

    default:
      break;
  }

  return sortedList;
};

const useRoutineTaskFilterStore = create((set) => ({
  isActive: false,
  checklist: "any",
  companies: [],
  categories: [],
  searchTerm: "",
  sortingOptions: [
    {
      label: "Сначала новые",
    },
    { label: "Сначала старые" },
    { label: "По алфавиту" },
    { label: "Следующая заявка" },
  ],
  sortBy: {
    label: "Сначала новые",
  },
  isSorting: false,
  handleSorting: async (data) => {
    set({ isSorting: true });

    // Set new sort option immediately
    set({ sortBy: data });

    // Use Promise and setTimeout to make sorting async
    await new Promise((resolve) => setTimeout(resolve, 0));

    set((state) => {
      const sortedList = handleSorting(data, state.filteredList);
      return {
        sortBy: data,
        filteredList: sortedList,
        isSorting: false,
      };
    });
  },
  originalList: [],
  filteredList: [],
  fullTextSearch: (query) =>
    set((state) => ({ filteredList: searchItems(query, taskFilter(state)) })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );
    const data = await response.json();
    set({
      originalList: data,
      isLoading: false,
    });
  },
  updateFilter: (data) =>
    set(() => {
      return {
        isActive: data.isActive,
        checklist: data.checklist,
        companies: data.companies,
        categories: data.categories,
        searchTerm: data.searchTerm,
        originalList: data.originalList,
        isLoading: false,
      };
    }),

  applyFilter: () => {
    set((state) => ({ filteredList: taskFilter(state) }));
  },
  resetFilter: () => {
    set(() => ({
      responsibles: [],
      isActive: false,
      checklist: "any",
      companies: [],
      categories: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: taskFilter(state),
    }));
  },
}));

export default useRoutineTaskFilterStore;

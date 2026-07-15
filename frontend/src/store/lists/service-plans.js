import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

const servicePlanFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  // Фасеты храним объектами (бейджам нужны имена) — сравниваем по _id
  const companyIds = (state.companies || []).map((company) =>
    String(company._id),
  );
  const categoryIds = (state.ticketCategories || []).map((category) =>
    String(category._id),
  );

  return originalList
    .filter((plan) =>
      state.type && state.type !== "any" ? plan.type === state.type : true,
    )
    .filter((plan) => {
      if (companyIds.length === 0) return true;
      return (plan.companies || []).some((company) =>
        companyIds.includes(String(company._id)),
      );
    })
    .filter((plan) => {
      if (categoryIds.length === 0) return true;
      return (plan.ticketCategories || []).some((category) =>
        categoryIds.includes(String(category._id)),
      );
    })
    .filter((plan) => {
      if (state.searchTerm.length > 0) {
        const haystack = [
          plan.title,
          ...(plan.companies || []).map((company) => company.alias),
          ...(plan.ticketCategories || []).map((category) => category.title),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(state.searchTerm);
      }
      return true;
    });
};

const searchItems = (query, items) => {
  if (!query) return items;

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [
      item.title,
      ...(item.companies || []).map((company) => company.alias),
      ...(item.ticketCategories || []).map((category) => category.title),
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

    default:
      break;
  }

  return sortedList;
};

const useServicePlanFilterStore = create((set) => ({
  type: "any",
  companies: [],
  ticketCategories: [],
  searchTerm: "",
  sortingOptions: [
    { label: "По алфавиту" },
    { label: "Сначала новые" },
    { label: "Сначала старые" },
  ],
  sortBy: {
    label: "По алфавиту",
  },
  isSorting: false,
  handleSorting: async (data) => {
    set({ isSorting: true });
    set({ sortBy: data });
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
    set((state) => ({
      filteredList: searchItems(query, servicePlanFilter(state)),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );
    const data = await response.json();
    set({
      originalList: Array.isArray(data) ? data : [],
      isLoading: false,
    });
  },
  updateFilter: (data) =>
    set(() => ({
      type: data.type ?? "any",
      companies: Array.isArray(data.companies) ? data.companies : [],
      ticketCategories: Array.isArray(data.ticketCategories)
        ? data.ticketCategories
        : [],
      originalList: Array.isArray(data.originalList) ? data.originalList : [],
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({ filteredList: servicePlanFilter(state) })),
  resetFilter: () => {
    set(() => ({
      type: "any",
      companies: [],
      ticketCategories: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: servicePlanFilter(state),
    }));
  },
}));

export default useServicePlanFilterStore;

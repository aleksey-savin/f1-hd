import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

const servicePlanFilter = (state) => {
  const originalList = state.originalList || [];

  return originalList.filter((item) => {
    if (state.searchTerm.length > 0) {
      const searchText = [
        item.title,
        ...(Array.isArray(item.ticketCategories)
          ? item.ticketCategories.map((category) => category.title)
          : []),
        ...(Array.isArray(item.companies)
          ? item.companies.map((company) => company.alias)
          : []),
      ]
        .join(" ")
        .toLowerCase();

      return searchText.includes(state.searchTerm.toLowerCase());
    }

    return true;
  });
};

const searchItems = (query, items) => {
  if (!query) return items;

  // Split the query into individual terms (e.g., "Ольга Вознюк" becomes ["Ольга", "Вознюк"])
  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [
      item.title,
      JSON.stringify(item.companies),
      JSON.stringify(item.categories),
    ];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term),
      ),
    );
  });
};

const useServicePlanFilterStore = create((set) => ({
  provisionSchedule: "any",
  ticketCategories: [],
  companies: [],
  tariffPlan: "any",
  searchTerm: "",
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
      `${import.meta.env.VITE_API_ADDRESS}/api/service-plans`,
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
  applyFilter: () =>
    set((state) => ({ filteredList: servicePlanFilter(state) })),
  resetFilter: () => {
    set(() => ({
      provisionSchedule: "any",
      ticketCategories: [],
      companies: [],
      tariff: "any",
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: servicePlanFilter(state),
    }));
  },
}));

export default useServicePlanFilterStore;

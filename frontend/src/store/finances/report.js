import { create } from "zustand";

const summaryReportFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList.filter((item) => {
    if (state.searchTerm.length > 0) {
      return [item.title].join(" ").toLowerCase().includes(state.searchTerm);
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
    const fieldsToSearch = [item.title];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term),
      ),
    );
  });
};

const useSummaryReportFilterStore = create((set) => ({
  statuses: [],
  searchTerm: "",
  originalList: [],
  filteredList: [],
  fullTextSearch: (query) =>
    set((state) => ({
      filteredList: searchItems(query, summaryReportFilter(state)),
    })),
  isLoading: false,
  setOriginalList: (data) =>
    set(() => ({
      originalList: data,
    })),
  updateFilter: (data) =>
    set(() => {
      return {
        statuses: data.statuses,
        searchTerm: data.searchTerm,
        originalList: data.originalList,
        isLoading: false,
      };
    }),

  applyFilter: () =>
    set((state) => ({ filteredList: summaryReportFilter(state) })),
  resetFilter: () => {
    set(() => ({
      statuses: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: summaryReportFilter(state),
    }));
  },
}));

export default useSummaryReportFilterStore;

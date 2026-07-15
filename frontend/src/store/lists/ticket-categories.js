import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

const ticketCategoryFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  // Фасеты храним объектами (бейджам нужны имена) — сравниваем по _id
  const userIds = (state.users || []).map((user) => String(user._id));
  const planIds = (state.servicePlans || []).map((plan) => String(plan._id));
  return originalList
    .filter((category) => {
      if (userIds.length === 0) return true;
      return (category.users || []).some((user) =>
        userIds.includes(String(user._id)),
      );
    })
    .filter((category) => {
      if (planIds.length === 0) return true;
      return (category.servicePlans || []).some((plan) =>
        planIds.includes(String(plan._id)),
      );
    })
    .filter((category) => (state.isActive ? category.isActive : true))
    .filter((category) =>
      state.alwaysWithinPlan ? category.alwaysWithinPlan : true,
    )
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [item.title].join(" ").toLowerCase().includes(state.searchTerm);
      }
      return true;
    });
};

const searchItems = (query, items) => {
  if (!query) return items;

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [item.title, item.description];

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

const useTicketCategoryFilterStore = create((set) => ({
  isActive: false,
  alwaysWithinPlan: false,
  users: [],
  servicePlans: [],
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
      filteredList: searchItems(query, ticketCategoryFilter(state)),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories`,
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
      isActive: data.isActive,
      alwaysWithinPlan: data.alwaysWithinPlan,
      users: Array.isArray(data.users) ? data.users : [],
      servicePlans: Array.isArray(data.servicePlans) ? data.servicePlans : [],
      originalList: Array.isArray(data.originalList) ? data.originalList : [],
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({ filteredList: ticketCategoryFilter(state) })),
  resetFilter: () => {
    set(() => ({
      isActive: false,
      alwaysWithinPlan: false,
      users: [],
      servicePlans: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: ticketCategoryFilter(state),
    }));
  },
}));

export default useTicketCategoryFilterStore;

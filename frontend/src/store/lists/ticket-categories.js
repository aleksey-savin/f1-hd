import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

const ticketCategoryFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList
    .filter((category) => {
      if (state.users?.length > 0) {
        const isEqual = (a, b) => a === b;
        return category.users
          .map((user) => user._id.toString())
          .some((item2) => state.users.some((item1) => isEqual(item1, item2)));
      } else {
        return true;
      }
    })
    .filter((category) => {
      if (state.servcePlans?.length > 0) {
        const isEqual = (a, b) => a === b;
        return category.servicePlans
          .map((plan) => plan._id.toString())
          .some((item2) =>
            state.servicePlans.some((item1) => isEqual(item1, item2)),
          );
      } else {
        return true;
      }
    })
    .filter((category) => {
      if (state.isActive) {
        return category.isActive;
      } else {
        return true;
      }
    })
    .filter((category) => {
      if (state.alwaysWithinPlan) {
        return category.alwaysWithinPlan;
      } else {
        return true;
      }
    })
    .filter((item) => {
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
    {
      label: "Сначала новые",
    },
    { label: "Сначала старые" },
  ],
  sortBy: {
    label: "По алфавиту",
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
      originalList: data,
      isLoading: false,
    });
  },
  updateFilter: (data) =>
    set(() => ({
      isActive: data.isActive,
      alwaysWithinPlan: data.alwaysWithinPlan,
      users: data.users,
      servicePlans: data.servicePlans,
      originalList: data.originalList,
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({ filteredList: ticketCategoryFilter(state) })),
  resetFilter: () => {
    set(() => ({
      isActive: "any",
      alwaysWithinPlan: "any",
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

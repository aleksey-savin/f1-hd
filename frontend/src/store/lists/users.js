import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

// Returns true when the user's last activity (date of their latest ticket)
// falls into the requested range. "inactive6m" also matches users with no
// activity at all (they have never created a ticket).
const matchesLastActivityRange = (item, range) => {
  if (!range || range === "any") return true;

  const last = item.lastActivity?.date
    ? new Date(item.lastActivity.date)
    : null;
  const now = new Date();

  switch (range) {
    case "currentMonth": {
      if (!last) return false;
      return last >= new Date(now.getFullYear(), now.getMonth(), 1);
    }
    case "currentYear": {
      if (!last) return false;
      return last >= new Date(now.getFullYear(), 0, 1);
    }
    case "inactive6m": {
      if (!last) return true; // never active
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return last < sixMonthsAgo;
    }
    default:
      return true;
  }
};

const userFilter = (state) => {
  const originalList = state.originalList || [];

  return originalList
    .filter((item) => (state.isActive ? item.isActive : true))
    .filter((item) =>
      Array.isArray(state.companies) && state.companies.length > 0
        ? state.companies.includes(item.company?._id?.toString())
        : true,
    )
    .filter((item) => matchesLastActivityRange(item, state.lastActivityRange))
    .filter((item) => {
      if (
        Array.isArray(state.timeTrackingModule) &&
        state.timeTrackingModule.length > 0
      ) {
        return (
          state.timeTrackingModule.filter(
            (permission) => item.permissions?.[permission] === true,
          ).length > 0
        );
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        const searchText = [
          item.email,
          item.phone,
          `${item.firstName} ${item.lastName}`,
          item.firstName,
          item.lastName,
          item.position,
          item.role,
          ...(Array.isArray(item.categories)
            ? item.categories.map((category) => category.title)
            : []),
          ...(Array.isArray(item.responsibleForCompanies)
            ? item.responsibleForCompanies.map((company) => company.alias)
            : []),
          item.company?.alias,
        ]
          .join(" ")
          .toLowerCase();

        return searchText.includes(state.searchTerm.toLowerCase());
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
      item.email,
      item.phone,
      `${item.firstName} ${item.lastName}`,
      item.firstName,
      item.lastName,
      item.position,
      item.role,
      JSON.stringify(item.categories),
      JSON.stringify(item.responsibleForCompanies),
      item.company?.alias,
    ];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term),
      ),
    );
  });
};

// Sort by last-activity timestamp. Users without activity always sink to the
// bottom, regardless of direction.
const activitySort = (a, b, direction) => {
  const aTime = a.lastActivity?.date
    ? new Date(a.lastActivity.date).getTime()
    : null;
  const bTime = b.lastActivity?.date
    ? new Date(b.lastActivity.date).getTime()
    : null;

  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;

  return direction === "asc" ? aTime - bTime : bTime - aTime;
};

const handleSorting = (selected, list) => {
  if (!selected || !list.length) {
    return;
  }

  const sortedList = [...list];

  switch (selected.label) {
    case "По алфавиту":
      sortedList.sort((a, b) => {
        const aValue =
          a.lastName.trim() === "" ? a.firstName.trim() : a.lastName.trim();
        const bValue =
          b.lastName.trim() === "" ? b.firstName.trim() : b.lastName.trim();
        return aValue.localeCompare(bValue);
      });
      break;

    case "Сначала новые":
      sortedList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;

    case "Сначала старые":
      sortedList.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;

    case "Активность: сначала недавние":
      sortedList.sort((a, b) => activitySort(a, b, "desc"));
      break;

    case "Активность: сначала давние":
      sortedList.sort((a, b) => activitySort(a, b, "asc"));
      break;

    default:
      break;
  }

  return sortedList;
};

const useUserFilterStore = create((set, get) => ({
  isAdmin: false,
  isServiceAccount: false,
  isCloudTelephony: false,
  permissions: [],
  tgBot: "any",
  isActive: true,
  roles: [],
  categories: [],
  companies: [],
  lastActivityRange: "any",
  respForCompanies: [],
  timeTrackingModule: [],
  searchTerm: "",
  sortingOptions: [
    { label: "По алфавиту" },
    {
      label: "Сначала новые",
    },
    { label: "Сначала старые" },
    { label: "Активность: сначала недавние" },
    { label: "Активность: сначала давние" },
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
    set((state) => ({ filteredList: searchItems(query, userFilter(state)) })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    // When the "only active" toggle is on, request active users only — inactive
    // accounts are fetched from the backend only after the toggle is disabled.
    const url = new URL(`${import.meta.env.VITE_API_ADDRESS}/api/users`);
    if (get().isActive) {
      url.searchParams.set("activeOnly", "true");
    }
    const response = await fetch(url, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });
    const data = await response.json();
    set({
      originalList: data.users,
      isLoading: false,
    });
  },
  updateFilter: (data) =>
    set(() => ({
      isActive: data.isActive,
      companies: data.companies,
      lastActivityRange: data.lastActivityRange,
      timeTrackingModule: data.timeTrackingModule,
      searchTerm: data.searchTerm,
      originalList: data.originalList,
      isLoading: false,
    })),
  applyFilter: () => set((state) => ({ filteredList: userFilter(state) })),
  resetFilter: () => {
    set(() => ({
      isAdmin: false,
      isServiceAccount: false,
      isCloudTelephony: false,
      permissions: [],
      tgBot: "any",
      isActive: true,
      roles: [],
      categories: [],
      companies: [],
      lastActivityRange: "any",
      respForCompanies: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: userFilter(state),
    }));
  },
}));

export default useUserFilterStore;

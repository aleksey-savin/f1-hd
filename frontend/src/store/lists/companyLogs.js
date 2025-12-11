import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

const companyLogsFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList
    .filter((log) => {
      if (state.actions?.length > 0) {
        return state.actions.includes(log.action);
      } else {
        return true;
      }
    })
    .filter((log) => {
      if (state.linkedUsers?.length > 0) {
        if (state.linkedUsers.includes("linked")) {
          return log.userId !== null;
        }
        if (state.linkedUsers.includes("unlinked")) {
          return log.userId === null;
        }
        return true;
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [
          item.firstName,
          item.lastName,
          item.activeDirectoryLogin,
          item.computerName,
          item.activeDirectoryObjectGUID,
          item.userId?.firstName,
          item.userId?.lastName,
          item.userId?.email,
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

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [
      item.firstName,
      item.lastName,
      item.activeDirectoryLogin,
      item.computerName,
      item.activeDirectoryObjectGUID,
      item.userId?.firstName,
      item.userId?.lastName,
      item.userId?.email,
      `${item.firstName} ${item.lastName}`,
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
    case "Сначала новые":
      sortedList.sort((a, b) => new Date(b.timeStamp) - new Date(a.timeStamp));
      break;

    case "Сначала старые":
      sortedList.sort((a, b) => new Date(a.timeStamp) - new Date(b.timeStamp));
      break;

    case "По имени":
      sortedList.sort((a, b) => {
        const nameA = `${a.firstName} ${a.lastName}`.toLowerCase();
        const nameB = `${b.firstName} ${b.lastName}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });
      break;

    case "По компьютеру":
      sortedList.sort((a, b) => {
        const compA = (a.computerName || "").toLowerCase();
        const compB = (b.computerName || "").toLowerCase();
        return compA.localeCompare(compB);
      });
      break;

    default:
      break;
  }

  return sortedList;
};

const useCompanyLogsFilterStore = create((set, get) => ({
  companyId: null,
  actions: [],
  linkedUsers: [],
  searchTerm: "",
  sortingOptions: [
    { label: "Сначала новые" },
    { label: "Сначала старые" },
    { label: "По имени" },
    { label: "По компьютеру" },
  ],
  sortBy: {
    label: "Сначала новые",
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
  pagination: {
    current: 1,
    total: 1,
    count: 0,
    limit: 50,
  },
  fullTextSearch: (query) =>
    set((state) => ({
      filteredList: searchItems(query, companyLogsFilter(state)),
    })),
  isLoading: false,
  setCompanyId: (companyId) => set({ companyId }),
  fetch: async (page = 1, limit = 50) => {
    const state = get();
    if (!state.companyId) return;

    set({ isLoading: true });
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/companies/${state.companyId}/logs?page=${page}&limit=${limit}`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        set({
          originalList: data.logs,
          pagination: data.pagination,
          isLoading: false,
        });
      } else {
        console.error("Failed to fetch company logs");
        set({ isLoading: false });
      }
    } catch (error) {
      console.error("Error fetching company logs:", error);
      set({ isLoading: false });
    }
  },
  linkUserToLog: async (logId, userId) => {
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/companies/link-user-to-ad`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            logId,
            userId,
          }),
        },
      );

      if (response.ok) {
        // Обновляем данные после успешного связывания
        const state = get();
        await state.fetch(state.pagination.current, state.pagination.limit);
        return true;
      } else {
        console.error("Failed to link user");
        return false;
      }
    } catch (error) {
      console.error("Error linking user:", error);
      return false;
    }
  },
  updateFilter: (data) =>
    set(() => {
      return {
        actions: data.actions,
        linkedUsers: data.linkedUsers,
        searchTerm: data.searchTerm,
        originalList: data.originalList,
      };
    }),
  applyFilter: () => set((state) => ({ filteredList: companyLogsFilter(state) })),
  resetFilter: () => {
    set(() => ({
      actions: [],
      linkedUsers: [],
    }));
    set((state) => ({
      filteredList: companyLogsFilter(state),
    }));
  },
}));

export default useCompanyLogsFilterStore;

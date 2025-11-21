import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

// Enhanced filter function that includes location and responsibility data
const enhancedClientDeviceFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList.filter((item) => {
    // Search term filter
    if (state.searchTerm.length > 0) {
      const searchFields = [
        item.company?.alias,
        item.company?.fullTitle,
        item.user?.firstName,
        item.user?.lastName,
        item.user?.email,
        item.location,
        item.locationPath, // New: hierarchical location path
        item.deviceType?.name,
        item.vendor?.name,
        item.model,
        item.serialNumber,
        item.purchaseDocument,
        item.status,
        item.notes,
        item.assignedTo,
        item.ipAddress,
        item.macAddress,
        item.operatingSystem,
        item.currentResponsibility?.responsibleUser?.firstName,
        item.currentResponsibility?.responsibleUser?.lastName,
        item.currentResponsibility?.responsibleUser?.email,
        item.currentResponsibility?.responsibilityType
      ];

      const matchesSearch = searchFields
        .join(" ")
        .toLowerCase()
        .includes(state.searchTerm);

      if (!matchesSearch) return false;
    }

    // Location type filter
    if (state.locationTypeFilter && state.locationTypeFilter !== "all") {
      if (!item.structuredLocation || item.structuredLocation.type !== state.locationTypeFilter) {
        return false;
      }
    }

    // Location filter (specific location)
    if (state.locationFilter && state.locationFilter !== "all") {
      if (item.locationId !== state.locationFilter) {
        return false;
      }
    }

    // Responsibility status filter
    if (state.responsibilityFilter && state.responsibilityFilter !== "all") {
      switch (state.responsibilityFilter) {
        case "assigned":
          if (!item.currentResponsibility || !item.currentResponsibility.isActive) {
            return false;
          }
          break;
        case "unassigned":
          if (item.currentResponsibility && item.currentResponsibility.isActive) {
            return false;
          }
          break;
        case "personal":
          if (!item.currentResponsibility ||
              item.currentResponsibility.responsibilityType !== "personal") {
            return false;
          }
          break;
        case "department":
          if (!item.currentResponsibility ||
              item.currentResponsibility.responsibilityType !== "department") {
            return false;
          }
          break;
        case "shared":
          if (!item.currentResponsibility ||
              item.currentResponsibility.responsibilityType !== "shared") {
            return false;
          }
          break;
      }
    }

    // Device type filter
    if (state.deviceTypeFilter && state.deviceTypeFilter !== "all") {
      if (item.deviceType?._id !== state.deviceTypeFilter) {
        return false;
      }
    }

    // Status filter
    if (state.statusFilter && state.statusFilter !== "all") {
      if (item.status !== state.statusFilter) {
        return false;
      }
    }

    // Company filter
    if (state.companyFilter && state.companyFilter !== "all") {
      if (item.company?._id !== state.companyFilter) {
        return false;
      }
    }

    // Date range filter (warranty expiration)
    if (state.warrantyExpirationFilter && state.warrantyExpirationFilter !== "all") {
      const now = new Date();
      const warrantyDate = new Date(item.warrantyExpirationDate);
      const daysUntilExpiry = Math.ceil((warrantyDate - now) / (1000 * 60 * 60 * 24));

      switch (state.warrantyExpirationFilter) {
        case "expired":
          if (daysUntilExpiry > 0) return false;
          break;
        case "expiring_soon":
          if (daysUntilExpiry < 0 || daysUntilExpiry > 30) return false;
          break;
        case "valid":
          if (daysUntilExpiry <= 30) return false;
          break;
      }
    }

    return true;
  });
};

// Enhanced search function with multi-field support
const enhancedSearchItems = (query, items) => {
  if (!query) return items;

  // Split the query into individual terms
  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [
      item.company?.alias,
      item.company?.fullTitle,
      item.user?.firstName,
      item.user?.lastName,
      item.user?.email,
      item.location,
      item.locationPath,
      item.structuredLocation?.name,
      item.structuredLocation?.fullPath,
      item.deviceType?.name,
      item.vendor?.name,
      item.model,
      item.serialNumber,
      item.purchaseDocument,
      item.status,
      item.notes,
      item.assignedTo,
      item.ipAddress,
      item.macAddress,
      item.operatingSystem,
      item.currentResponsibility?.responsibleUser?.firstName,
      item.currentResponsibility?.responsibleUser?.lastName,
      item.currentResponsibility?.responsibleUser?.email,
      item.currentResponsibility?.responsibilityType
    ];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term),
      ),
    );
  });
};

const useEnhancedClientDeviceFilterStore = create((set, get) => ({
  // State
  searchTerm: "",
  originalList: [],
  filteredList: [],
  isLoading: false,

  // Enhanced filters
  locationTypeFilter: "all", // all, building, floor, room, workplace
  locationFilter: "all", // all, specific location ID
  responsibilityFilter: "all", // all, assigned, unassigned, personal, department, shared
  deviceTypeFilter: "all", // all, specific device type ID
  statusFilter: "all", // all, specific status
  companyFilter: "all", // all, specific company ID
  warrantyExpirationFilter: "all", // all, expired, expiring_soon, valid

  // Statistics
  statistics: {
    total: 0,
    assigned: 0,
    unassigned: 0,
    byLocation: {},
    byStatus: {},
    byResponsibilityType: {},
    warrantyExpiring: 0,
    warrantyExpired: 0
  },

  // Actions
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/enhanced`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const data = await response.json();

      // Calculate statistics
      const statistics = get().calculateStatistics(data);

      set({
        originalList: data,
        statistics,
        isLoading: false,
      });

      // Apply current filters
      get().applyFilter();
    } catch (error) {
      console.error("Error fetching enhanced client devices:", error);
      set({ isLoading: false });
    }
  },

  updateFilter: (data) =>
    set(() => ({
      searchTerm: data.searchTerm || "",
      originalList: data.originalList || [],
      isLoading: false,
    })),

  fullTextSearch: (query) =>
    set((state) => ({
      searchTerm: query,
      filteredList: enhancedSearchItems(query, enhancedClientDeviceFilter(state)),
    })),

  applyFilter: () =>
    set((state) => {
      return { filteredList: enhancedClientDeviceFilter(state) };
    }),

  // Enhanced filter setters
  setLocationTypeFilter: (filter) =>
    set((state) => {
      const newState = { ...state, locationTypeFilter: filter };
      return {
        locationTypeFilter: filter,
        filteredList: enhancedClientDeviceFilter(newState)
      };
    }),

  setLocationFilter: (filter) =>
    set((state) => {
      const newState = { ...state, locationFilter: filter };
      return {
        locationFilter: filter,
        filteredList: enhancedClientDeviceFilter(newState)
      };
    }),

  setResponsibilityFilter: (filter) =>
    set((state) => {
      const newState = { ...state, responsibilityFilter: filter };
      return {
        responsibilityFilter: filter,
        filteredList: enhancedClientDeviceFilter(newState)
      };
    }),

  setDeviceTypeFilter: (filter) =>
    set((state) => {
      const newState = { ...state, deviceTypeFilter: filter };
      return {
        deviceTypeFilter: filter,
        filteredList: enhancedClientDeviceFilter(newState)
      };
    }),

  setStatusFilter: (filter) =>
    set((state) => {
      const newState = { ...state, statusFilter: filter };
      return {
        statusFilter: filter,
        filteredList: enhancedClientDeviceFilter(newState)
      };
    }),

  setCompanyFilter: (filter) =>
    set((state) => {
      const newState = { ...state, companyFilter: filter };
      return {
        companyFilter: filter,
        filteredList: enhancedClientDeviceFilter(newState)
      };
    }),

  setWarrantyExpirationFilter: (filter) =>
    set((state) => {
      const newState = { ...state, warrantyExpirationFilter: filter };
      return {
        warrantyExpirationFilter: filter,
        filteredList: enhancedClientDeviceFilter(newState)
      };
    }),

  resetFilters: () => {
    set(() => ({
      searchTerm: "",
      locationTypeFilter: "all",
      locationFilter: "all",
      responsibilityFilter: "all",
      deviceTypeFilter: "all",
      statusFilter: "all",
      companyFilter: "all",
      warrantyExpirationFilter: "all"
    }));

    const state = get();
    set({ filteredList: enhancedClientDeviceFilter(state) });
  },

  // Statistics calculation
  calculateStatistics: (devices) => {
    const stats = {
      total: devices.length,
      assigned: 0,
      unassigned: 0,
      byLocation: {},
      byStatus: {},
      byResponsibilityType: {},
      warrantyExpiring: 0,
      warrantyExpired: 0
    };

    const now = new Date();

    devices.forEach(device => {
      // Responsibility statistics
      if (device.currentResponsibility && device.currentResponsibility.isActive) {
        stats.assigned++;
        const type = device.currentResponsibility.responsibilityType;
        stats.byResponsibilityType[type] = (stats.byResponsibilityType[type] || 0) + 1;
      } else {
        stats.unassigned++;
      }

      // Location statistics
      const locationKey = device.structuredLocation?.fullPath || device.location || "Не указано";
      stats.byLocation[locationKey] = (stats.byLocation[locationKey] || 0) + 1;

      // Status statistics
      stats.byStatus[device.status] = (stats.byStatus[device.status] || 0) + 1;

      // Warranty statistics
      if (device.warrantyExpirationDate) {
        const warrantyDate = new Date(device.warrantyExpirationDate);
        const daysUntilExpiry = Math.ceil((warrantyDate - now) / (1000 * 60 * 60 * 24));

        if (daysUntilExpiry < 0) {
          stats.warrantyExpired++;
        } else if (daysUntilExpiry <= 30) {
          stats.warrantyExpiring++;
        }
      }
    });

    return stats;
  },

  // Bulk operations
  bulkUpdateResponsibility: async (deviceIds, responsibilityData) => {
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/bulk-responsibility`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ deviceIds, responsibilityData }),
        },
      );

      if (response.ok) {
        // Refresh the data
        await get().fetch();
        return { success: true };
      } else {
        const errorData = await response.json();
        return { success: false, error: errorData.message };
      }
    } catch (error) {
      console.error("Error in bulk responsibility update:", error);
      return { success: false, error: error.message };
    }
  },

  bulkUpdateLocation: async (deviceIds, locationId) => {
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/bulk-location`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ deviceIds, locationId }),
        },
      );

      if (response.ok) {
        // Refresh the data
        await get().fetch();
        return { success: true };
      } else {
        const errorData = await response.json();
        return { success: false, error: errorData.message };
      }
    } catch (error) {
      console.error("Error in bulk location update:", error);
      return { success: false, error: error.message };
    }
  },

  // Export functions
  exportFilteredData: () => {
    const { filteredList } = get();
    return filteredList.map(device => ({
      "Компания": device.company?.alias || "",
      "Пользователь": device.user ? `${device.user.firstName} ${device.user.lastName}` : "",
      "Email": device.user?.email || "",
      "Расположение": device.structuredLocation?.fullPath || device.location || "",
      "Тип устройства": device.deviceType?.name || "",
      "Производитель": device.vendor?.name || "",
      "Модель": device.model || "",
      "Серийный номер": device.serialNumber || "",
      "Статус": device.status || "",
      "Ответственный": device.currentResponsibility?.responsibleUser ?
        `${device.currentResponsibility.responsibleUser.firstName} ${device.currentResponsibility.responsibleUser.lastName}` : "",
      "Тип ответственности": device.currentResponsibility?.responsibilityType || "",
      "IP-адрес": device.ipAddress || "",
      "MAC-адрес": device.macAddress || "",
      "ОС": device.operatingSystem || "",
      "Дата покупки": device.purchaseDate || "",
      "Стоимость": device.price || "",
      "Гарантия до": device.warrantyExpirationDate || "",
      "Примечания": device.notes || ""
    }));
  }
}));

export default useEnhancedClientDeviceFilterStore;

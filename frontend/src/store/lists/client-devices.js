import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

// Searchable text fields of a populated client-device.
const deviceSearchFields = (item) => [
  item.companyId?.alias,
  item.companyId?.fullTitle,
  item.userId?.firstName,
  item.userId?.lastName,
  item.userId?.email,
  item.locationId?.name,
  item.deviceModelId?.name,
  item.deviceModelId?.vendorId?.name,
  item.deviceModelId?.deviceTypeId?.name,
  item.supplierId?.name,
  item.serialNumber,
  item.purchaseDocument,
  item.status,
  item.notes,
  item.ipAddress,
  item.macAddress,
  item.operatingSystem,
];

// функция последовательно отсеивает заявки согласно активным фильтрам
const clientDeviceFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  return originalList.filter((item) => {
    if (state.searchTerm.length > 0) {
      return deviceSearchFields(item)
        .filter(Boolean)
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
    const fieldsToSearch = deviceSearchFields(item);
    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && String(field).toLowerCase().includes(term),
      ),
    );
  });
};

const useClientDeviceFilterStore = create((set) => ({
  searchTerm: "",
  originalList: [],
  filteredList: [],
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices`,
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
      searchTerm: data.searchTerm,
      originalList: data.originalList,
      isLoading: false,
    })),
  fullTextSearch: (query) =>
    set((state) => ({
      filteredList: searchItems(query, clientDeviceFilter(state)),
    })),
  applyFilter: () =>
    set((state) => {
      return { filteredList: clientDeviceFilter(state) };
    }),
  resetFilter: () => {
    set(() => ({
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: clientDeviceFilter(state),
    }));
  },
}));

export default useClientDeviceFilterStore;

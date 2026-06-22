import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";
import { CUSTOM_VENDOR_BUCKET } from "../../components/ClientDevice/constants";

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
  item.deviceTypeId?.name,
  item.supplierId?.name,
  item.serialNumber,
  item.inventoryNumber,
  item.purchaseDocument,
  item.status,
  item.notes,
  item.ipAddress,
  item.macAddress,
  item.operatingSystem,
];

// функция последовательно отсеивает устройства согласно активным фильтрам
// (И между разделами, ИЛИ внутри раздела; пустой раздел не фильтрует)
const clientDeviceFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  return originalList
    .filter(
      (item) =>
        !state.companies?.length ||
        state.companies.includes(item.companyId?._id?.toString()),
    )
    .filter(
      (item) =>
        !state.locations?.length ||
        state.locations.includes(item.locationId?._id?.toString()),
    )
    .filter((item) => {
      if (!state.vendors?.length) return true;
      const vendorId = item.deviceModelId?.vendorId?._id?.toString();
      // Без модели/вендора — самосборка, попадает в бакет «Кастомная сборка».
      return vendorId
        ? state.vendors.includes(vendorId)
        : state.vendors.includes(CUSTOM_VENDOR_BUCKET);
    })
    .filter((item) => {
      if (!state.deviceTypes?.length) return true;
      // Тип — из модели (заводская сборка) или напрямую (самосборное).
      const typeId = (
        item.deviceModelId?.deviceTypeId?._id || item.deviceTypeId?._id
      )?.toString();
      return state.deviceTypes.includes(typeId);
    })
    .filter(
      (item) => !state.statuses?.length || state.statuses.includes(item.status),
    )
    .filter((item) => {
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
  // Мульти-селект фильтры (массивы выбранных id / значений)
  companies: [],
  locations: [],
  vendors: [],
  deviceTypes: [],
  statuses: [],
  // Опции локаций, лениво подгружаемые по выбранным компаниям
  locationOptions: [],
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
      companies: data.companies ?? [],
      locations: data.locations ?? [],
      vendors: data.vendors ?? [],
      deviceTypes: data.deviceTypes ?? [],
      statuses: data.statuses ?? [],
      locationOptions: data.locationOptions ?? [],
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
      companies: [],
      locations: [],
      vendors: [],
      deviceTypes: [],
      statuses: [],
      locationOptions: [],
    }));
    set((state) => ({
      filteredList: clientDeviceFilter(state),
    }));
  },
}));

export default useClientDeviceFilterStore;

import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

// Фасеты фильтра дерева расположений. Компания — обязательный контекст (чип на
// панели, задаётся отдельно); showWorkplaces — чип «Рабочие места» (РМ скрыты
// по умолчанию, их много). Остальное — Sheet-фильтр: тип, статус,
// общедоступность, подразделение.
const locationFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList
    .filter(
      // Рабочие места по умолчанию скрыты — их обычно много; показываем по чипу.
      (location) => state.showWorkplaces || location.type !== "workplace",
    )
    .filter((location) => {
      // Тип расположения (мультивыбор; пусто = любой). Рабочие места здесь не
      // участвуют — ими управляет отдельный чип.
      const types = state.typeFilters || [];
      return types.length === 0 || types.includes(location.type);
    })
    .filter((location) => {
      // Статус активности (isActive по умолчанию true у старых данных)
      if (state.status === "active") return location.isActive !== false;
      if (state.status === "inactive") return location.isActive === false;
      return true;
    })
    .filter((location) => !state.publicOnly || location.isPublic === true)
    .filter((location) => {
      // Подразделение (расположение относится к нему)
      if (!state.subdivision?._id) return true;
      return (location.subdivisions || []).some(
        (sub) => String(sub?._id || sub) === String(state.subdivision._id),
      );
    })
    .filter((location) => {
      // Компания (обязательный контекст)
      if (state.selectedCompanyIds && state.selectedCompanyIds.length > 0) {
        return state.selectedCompanyIds.includes(location.company?._id);
      }
      return true;
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [
          item.name,
          item.description,
          item.address,
          item.company?.alias,
          item.company?.fullTitle,
          ...(item.subdivisions || []).map((s) => s?.name),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(state.searchTerm);
      }
      return true;
    });
};

const handleSorting = (selected, list) => {
  if (!selected || !list.length) {
    return;
  }

  const sortedList = [...list];

  switch (selected.label) {
    case "По названию":
      sortedList.sort((a, b) => a.name.localeCompare(b.name));
      break;

    case "По типу":
      sortedList.sort((a, b) => {
        const typeOrder = { building: 0, floor: 1, room: 2, workplace: 3 };
        return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
      });
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

// Дефолты фасетов Sheet-фильтра (для сброса — компанию и данные не трогаем).
const FACET_DEFAULTS = {
  showWorkplaces: false,
  typeFilters: [],
  status: "all",
  publicOnly: false,
  subdivision: null,
  searchTerm: "",
};

const useLocationFilterStore = create((set) => ({
  selectedCompanyIds: [],
  ...FACET_DEFAULTS,
  sortingOptions: [
    { label: "По названию" },
    { label: "По типу" },
    { label: "Сначала новые" },
    { label: "Сначала старые" },
  ],
  sortBy: {
    label: "По названию",
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
    set((state) => {
      const next = { ...state, searchTerm: query };
      return {
        searchTerm: query,
        filteredList: locationFilter(next),
      };
    }),
  isLoading: false,
  fetch: async (companyParam = null) => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();

    let url = `${import.meta.env.VITE_API_ADDRESS}/api/inventory/companies-locations`;

    const currentState = useLocationFilterStore.getState();
    if (companyParam) {
      url += `?companyIds=${companyParam}`;
    } else if (
      currentState.selectedCompanyIds &&
      currentState.selectedCompanyIds.length > 0
    ) {
      url += `?companyIds=${currentState.selectedCompanyIds.join(",")}`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    const data = response.ok ? await response.json() : [];
    set({
      originalList: data,
      isLoading: false,
    });
  },
  setShowWorkplaces: (value) =>
    set((state) => ({
      showWorkplaces: value,
      filteredList: locationFilter({ ...state, showWorkplaces: value }),
    })),
  setSelectedCompanies: (companyIds) =>
    set((state) => {
      const newState = { ...state, selectedCompanyIds: companyIds };
      return {
        selectedCompanyIds: companyIds,
        filteredList: locationFilter(newState),
      };
    }),

  // Универсальный патч фасетов + пересчёт списка с сортировкой.
  updateFilter: (patch) =>
    set((state) => {
      const next = { ...state, ...patch };
      const filtered = locationFilter(next);
      const sorted = handleSorting(state.sortBy, filtered);
      return { ...patch, filteredList: sorted || filtered };
    }),
  applyFilter: () => set((state) => ({ filteredList: locationFilter(state) })),
  // Сброс — только фасеты Sheet + поиск; компания и загруженные данные остаются
  // (иначе список без обязательного контекста опустеет).
  resetFilter: () =>
    set((state) => ({
      ...FACET_DEFAULTS,
      filteredList: locationFilter({
        ...state,
        ...FACET_DEFAULTS,
      }),
    })),
}));

export default useLocationFilterStore;

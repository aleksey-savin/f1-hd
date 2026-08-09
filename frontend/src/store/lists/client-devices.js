import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

// Список «Устройства» — реестр активов на серверной выборке: поиск, фасеты,
// сортировка, постраничность и счётчики стадий считает бэкенд (клиентский поиск
// несовместим с пагинацией, а парк растёт вместе с числом клиентов). Стор
// держит текущую порцию (items), общий счётчик (total) и состояние фасетов;
// каждое изменение фасета/сортировки/страницы делает запрос само.
//
// Контракт app/ListWrapper сохранён: fullTextSearch / handleSorting / sortBy /
// sortingOptions / isLoading / isSorting / resetFilter.
const API = import.meta.env.VITE_API_ADDRESS;
const PAGE_SIZE = 50;

const SORT = {
  created: { label: "Сначала новые" },
  inventory: { label: "По инв. номеру" },
};
const SORT_KEY_BY_LABEL = Object.fromEntries(
  Object.entries(SORT).map(([key, option]) => [option.label, key]),
);

const EMPTY_FACETS = {
  companies: [],
  locations: [],
  users: [],
  types: [],
  vendors: [],
  statuses: [],
  // Пробел учёта — флаг, а не набор: техника без инвентарного номера.
  noInventory: false,
  // Показывать детали сборок. Поиск включает их сам (см. бэкенд), свитч нужен
  // для просмотра: «покажи все модули памяти».
  withComponents: false,
};

let searchDebounce;
// Гонка листания: поздний ответ прошлого запроса не должен перетирать свежий.
let requestSeq = 0;

const buildParams = (state) => {
  const params = new URLSearchParams();
  Object.entries(state.facets).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else if (value) {
      params.set(key, "true");
    }
  });
  if (state.searchTerm) params.set("search", state.searchTerm);
  params.set("sort", SORT_KEY_BY_LABEL[state.sortBy?.label] || "created");
  params.set("page", String(state.page));
  params.set("limit", String(PAGE_SIZE));
  return params;
};

const doFetch = async (get, set, { append = false } = {}) => {
  const { token } = getLocalStorageData();
  const seq = ++requestSeq;
  set({ isLoading: true });
  try {
    const url = new URL(`${API}/api/inventory/client-devices`, window.location.origin);
    url.search = buildParams(get()).toString();
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`client-devices ${response.status}`);
    const data = await response.json();
    if (seq !== requestSeq) return;
    set((state) => ({
      items: append ? [...state.items, ...data.devices] : data.devices,
      total: typeof data.total === "number" ? data.total : data.devices.length,
      statusCounts: data.statusCounts || {},
      noInventoryNumber: data.noInventoryNumber || 0,
      componentsCount: data.componentsCount || 0,
      isLoading: false,
      isSorting: false,
    }));
  } catch (error) {
    if (seq === requestSeq) set({ isLoading: false, isSorting: false });
    console.warn("Загрузка устройств пропущена:", error);
  }
};

const useClientDeviceFilterStore = create((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  statusCounts: {},
  noInventoryNumber: 0,
  // Сколько из найденного — детали внутри сборок (подпись над списком).
  componentsCount: 0,
  // true с самого начала: страница монтируется уже с идущим запросом, и без
  // этого между первым кадром и ответом мигало бы «Список пуст».
  isLoading: true,
  isSorting: false,

  searchTerm: "",
  facets: { ...EMPTY_FACETS },
  // Опции фасетов приезжают отдельной ручкой: серверная выборка сужает набор,
  // из которого иначе собирались бы опции, и выбранное значение исчезало бы из
  // собственного фильтра, стоит начать печатать.
  options: { companies: [], locations: [], users: [], types: [], vendors: [] },

  sortingOptions: [SORT.created, SORT.inventory],
  sortBy: SORT.created,

  fetch: () => doFetch(get, set),

  fetchOptions: async () => {
    const { token } = getLocalStorageData();
    try {
      const response = await fetch(
        `${API}/api/inventory/client-devices/facets`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (!response.ok) throw new Error(`facets ${response.status}`);
      set({ options: await response.json() });
    } catch (error) {
      console.warn("Опции фильтра устройств пропущены:", error);
    }
  },

  setFacet: (key, value) => {
    set((state) => {
      const facets = { ...state.facets, [key]: value };
      // Расположения принадлежат компаниям: сменили набор компаний — выбранные
      // расположения, которых больше не предлагают, отваливаются вместе с ним.
      if (key === "companies") {
        facets.locations = value.length
          ? state.facets.locations.filter((locationId) =>
              state.options.locations.some(
                (option) =>
                  option.value === locationId && value.includes(option.company),
              ),
            )
          : [];
      }
      return { facets, page: 1 };
    });
    doFetch(get, set);
  },

  toggleNoInventory: () => {
    get().setFacet("noInventory", !get().facets.noInventory);
  },

  toggleComponents: () => {
    get().setFacet("withComponents", !get().facets.withComponents);
  },

  toggleStatus: (status) => {
    const current = get().facets.statuses;
    get().setFacet(
      "statuses",
      current.includes(status)
        ? current.filter((entry) => entry !== status)
        : [...current, status],
    );
  },

  setPage: (page) => {
    set({ page });
    doFetch(get, set);
  },
  loadMore: () => {
    set((state) => ({ page: state.page + 1 }));
    doFetch(get, set, { append: true });
  },

  handleSorting: async (option) => {
    set({ sortBy: option, isSorting: true, page: 1 });
    await doFetch(get, set);
  },

  fullTextSearch: (query) => {
    set({ searchTerm: query });
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      set({ page: 1 });
      doFetch(get, set);
    }, 300);
  },

  resetFilter: () => {
    set({ facets: { ...EMPTY_FACETS }, searchTerm: "", page: 1 });
    doFetch(get, set);
  },

  /**
   * Ссылки «Вся техника в „Устройствах“» с карточек компании и пользователя
   * (?company= | ?user=): фасет подставляется до первой загрузки, дальше
   * снимается как обычный — бейджем в плашке применённых фильтров.
   */
  applyPrefilter: ({ companyId, userId }) => {
    set((state) => ({
      facets: {
        ...state.facets,
        companies: companyId ? [companyId] : state.facets.companies,
        users: userId ? [userId] : state.facets.users,
      },
      page: 1,
    }));
    doFetch(get, set);
  },
}));

export default useClientDeviceFilterStore;

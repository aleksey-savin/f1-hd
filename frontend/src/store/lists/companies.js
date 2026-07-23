import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

// Стор списка компаний. Выборка клиентская (компаний десятки, страниц нет):
// бэкенд отдаёт компактную проекцию со счётчиками (usersCount,
// servicePlansCount), а фильтр, поиск и сортировка считаются здесь единым
// пайплайном recompute() — иначе фильтрация теряла применённую сортировку.
//
// Ответственные в поддокументах исторически несут id пользователя в _id
// (контроллер кладёт документы User целиком, и переданный _id становится
// _id поддокумента) — берём любой заполненный вариант.
export const getResponsibleId = (resp) => {
  const value = resp?.id?._id ?? resp?.id ?? resp?._id;
  return value ? String(value) : null;
};

const matchesResponsibles = (state, company) => {
  const ids = (company.responsibles ?? [])
    .map(getResponsibleId)
    .filter(Boolean);

  // «Мои» — сегмент-срез, работает поверх фасета ответственных
  if (state.mineOnly && state.myId && !ids.includes(String(state.myId))) {
    return false;
  }

  const selected = state.responsibles ?? [];
  if (!selected.length && !state.noResponsible) return true;

  const matchesSelected =
    selected.length > 0 && ids.some((id) => selected.includes(id));
  const matchesEmpty = state.noResponsible && ids.length === 0;
  return matchesSelected || matchesEmpty;
};

const companyFilter = (state) =>
  (state.originalList ?? []).filter(
    (company) =>
      matchesResponsibles(state, company) &&
      (!state.onlyWithServices || (company.servicePlansCount ?? 0) > 0) &&
      // «Только активные» (дефолт): отключённые видны лишь со снятым свитчем
      (!state.activeOnly || company.isActive !== false),
  );

const searchItems = (query, items) => {
  if (!query) return items;

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [
      item.alias,
      item.fullTitle,
      item.address,
      ...(item.emailDomains ?? []),
      ...(item.phones ?? []),
      ...(item.responsibles ?? []).flatMap((responsible) => [
        `${responsible?.firstName} ${responsible?.lastName}`,
        responsible?.firstName,
        responsible?.lastName,
        responsible?.email,
        responsible?.phone,
        responsible?.position,
      ]),
    ];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && String(field).toLowerCase().includes(term),
      ),
    );
  });
};

const sortItems = (selected, list) => {
  const sorted = [...list];

  switch (selected?.label) {
    case "По числу пользователей":
      sorted.sort(
        (a, b) =>
          (b.usersCount ?? 0) - (a.usersCount ?? 0) ||
          (a.alias ?? "").localeCompare(b.alias ?? ""),
      );
      break;

    case "По названию":
    default:
      sorted.sort((a, b) => (a.alias ?? "").localeCompare(b.alias ?? ""));
      break;
  }

  return sorted;
};

const recompute = (state) => ({
  filteredList: sortItems(
    state.sortBy,
    searchItems(state.searchTerm, companyFilter(state)),
  ),
});

const useCompanyFilterStore = create((set) => ({
  responsibles: [],
  noResponsible: false,
  onlyWithServices: false,
  activeOnly: true,
  mineOnly: false,
  myId: null,
  searchTerm: "",
  sortingOptions: [
    { label: "По названию" },
    { label: "По числу пользователей" },
  ],
  sortBy: { label: "По названию" },
  originalList: [],
  filteredList: [],
  isLoading: false,

  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    // Страница компаний — единственный потребитель с отключёнными: бэкенд по
    // умолчанию отдаёт только активные (выпадашки форм), фасетим клиентски
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies?includeInactive=true`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );
    const data = await response.json();
    set((state) => ({
      originalList: data,
      isLoading: false,
      ...recompute({ ...state, originalList: data }),
    }));
  },

  fullTextSearch: (query) =>
    set((state) => ({
      searchTerm: query,
      ...recompute({ ...state, searchTerm: query }),
    })),

  handleSorting: (option) =>
    set((state) => ({
      sortBy: option,
      ...recompute({ ...state, sortBy: option }),
    })),

  toggleResponsible: (id) =>
    set((state) => {
      const responsibles = state.responsibles.includes(id)
        ? state.responsibles.filter((selected) => selected !== id)
        : [...state.responsibles, id];
      return { responsibles, ...recompute({ ...state, responsibles }) };
    }),

  toggleNoResponsible: () =>
    set((state) => {
      const noResponsible = !state.noResponsible;
      return { noResponsible, ...recompute({ ...state, noResponsible }) };
    }),

  setOnlyWithServices: (onlyWithServices) =>
    set((state) => ({
      onlyWithServices,
      ...recompute({ ...state, onlyWithServices }),
    })),

  setActiveOnly: (activeOnly) =>
    set((state) => ({
      activeOnly,
      ...recompute({ ...state, activeOnly }),
    })),

  setMineOnly: (mineOnly, myId) =>
    set((state) => {
      const next = { mineOnly, myId: myId ?? state.myId };
      return { ...next, ...recompute({ ...state, ...next }) };
    }),

  applyFilter: () => set((state) => recompute(state)),

  updateFilter: (data) =>
    set((state) => ({ ...data, ...recompute({ ...state, ...data }) })),

  resetFilter: () =>
    set((state) => {
      const cleared = {
        responsibles: [],
        noResponsible: false,
        onlyWithServices: false,
        activeOnly: true,
        mineOnly: false,
        searchTerm: "",
      };
      return { ...cleared, ...recompute({ ...state, ...cleared }) };
    }),
}));

export default useCompanyFilterStore;

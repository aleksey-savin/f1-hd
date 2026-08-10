import { create } from "zustand";

const API = `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices`;

// Статус строки с учётом рубильника мониторинга: выключенный мониторинг — своя
// группа/фасет, а не «не в сети». Общий для страницы, шторки и фильтра.
export const rowStatus = (row) =>
  row?.monitoringEnabled ? row?.status || "offline" : "disabled";

// Searchable text fields of a managed-device row.
const rowSearchFields = (item) => [
  item.displayName,
  item.host,
  item.serialNumber,
  item.currentFirmware,
  item.boardName,
  item.type,
  item.model?.name,
  item.model?.vendor,
  item.location?.name,
  item.company?.name,
  item.jump?.name,
];

const searchItems = (query, items) => {
  if (!query) return items;

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = rowSearchFields(item);
    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && String(field).toLowerCase().includes(term),
      ),
    );
  });
};

// Фасеты Sheet-фильтра/чипа компаний. status: online|offline|disabled;
// firmware: vulnerable (CVE ≥ порога) | outdated (есть обновление) | current.
const EMPTY_FACETS = {
  status: null,
  companies: [],
  type: null,
  firmware: null,
};

const matchesFacets = (item, facets) => {
  if (facets.status && rowStatus(item) !== facets.status) return false;
  if (
    facets.companies.length > 0 &&
    !facets.companies.includes(String(item.company?.id))
  ) {
    return false;
  }
  if (facets.type && item.type !== facets.type) return false;
  if (facets.firmware) {
    const firmware = item.firmwareStatus;
    if (facets.firmware === "vulnerable" && !firmware?.vulnerable) return false;
    if (facets.firmware === "outdated" && !firmware?.updateAvailable) {
      return false;
    }
    if (
      facets.firmware === "current" &&
      (!firmware || firmware.updateAvailable)
    ) {
      return false;
    }
  }
  return true;
};

const getTime = (value) => (value ? new Date(value).getTime() : 0);

const sortList = (selected, list) => {
  const sorted = [...list];
  switch (selected?.label) {
    case "По алфавиту":
      sorted.sort((a, b) =>
        (a.displayName || "").localeCompare(b.displayName || "", "ru"),
      );
      break;
    // Худшая доступность сверху; «мало данных» (null) — в конец.
    case "По доступности":
      sorted.sort((a, b) => (a.uptime30d ?? 101) - (b.uptime30d ?? 101));
      break;
    case "Сначала недавние":
      sorted.sort(
        (a, b) => getTime(b.monitoredSince) - getTime(a.monitoredSince),
      );
      break;
    default:
      break;
  }
  return sorted;
};

// Единственное место пересчёта: фасеты → поиск → сортировка. Все мутаторы стора
// зовут его в том же set-вызове — страница больше не пересчитывает эффектами.
const recompute = (state) => {
  const base = (
    Array.isArray(state.originalList) ? state.originalList : []
  ).filter((item) => matchesFacets(item, state.facets));
  return sortList(state.sortBy, searchItems(state.searchTerm, base));
};

const authHeaders = () => ({
});

const jsonHeaders = () => ({
  "Content-Type": "application/json",
  ...authHeaders(),
});

const useMikrotikDeviceFilterStore = create((set, get) => ({
  searchTerm: "",
  facets: { ...EMPTY_FACETS },
  sortingOptions: [
    { label: "По алфавиту" },
    { label: "По доступности" },
    { label: "Сначала недавние" },
  ],
  sortBy: {
    label: "По алфавиту",
  },
  isSorting: false,
  handleSorting: (data) =>
    set((state) => ({
      sortBy: data,
      filteredList: recompute({ ...state, sortBy: data }),
    })),
  originalList: [],
  filteredList: [],
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const response = await fetch(API, { headers: authHeaders() });
    const data = await response.json();
    const originalList = Array.isArray(data) ? data : [];

    set((state) => ({
      originalList,
      isLoading: false,
      filteredList: recompute({ ...state, originalList }),
    }));
  },
  // Фоновое обновление без isLoading: свежие строки + пересчёт одним set-вызовом.
  // Статусы, доступность и индикаторы прошивки обновляются на месте; открытая
  // шторка устройства живёт на строке из originalList и не закрывается.
  silentRefresh: async () => {
    let data;
    try {
      const response = await fetch(API, { headers: authHeaders() });
      if (!response.ok) throw new Error(`mikrotik-devices ${response.status}`);
      data = await response.json();
    } catch (error) {
      // Транзиентный сетевой сбой на фоновом опросе ожидаем (сон вкладки,
      // обрыв связи) — тихо пропускаем цикл, следующий подтянет данные.
      console.warn("Фоновое обновление устройств Mikrotik пропущено:", error);
      return;
    }

    const originalList = Array.isArray(data) ? data : [];
    set((state) => ({
      originalList,
      filteredList: recompute({ ...state, originalList }),
    }));
  },
  // Кэш последних релизов RouterOS (+ свежесть CVE-синка) для полосы над
  // списком и страницы записи. Ошибка сети не затирает прежнее значение —
  // полоса живёт на stale-данных, как и бэкенд-кэш.
  releases: null,
  fetchReleases: async () => {
    try {
      const response = await fetch(`${API}/firmware/releases`, {
        headers: authHeaders(),
      });
      if (!response.ok) return;
      set({ releases: await response.json() });
    } catch {
      // фоновая загрузка полосы: сбой сети молча переживаем
    }
  },
  fullTextSearch: (query) =>
    set((state) => {
      const searchTerm = String(query || "").toLowerCase();
      return {
        searchTerm,
        filteredList: recompute({ ...state, searchTerm }),
      };
    }),
  setFacet: (key, value) =>
    set((state) => {
      const facets = { ...state.facets, [key]: value };
      return { facets, filteredList: recompute({ ...state, facets }) };
    }),
  resetFilter: () =>
    set((state) => {
      const next = {
        ...state,
        searchTerm: "",
        facets: { ...EMPTY_FACETS },
      };
      return {
        searchTerm: "",
        facets: next.facets,
        filteredList: recompute(next),
      };
    }),
  // Совместимость с легаси-потребителями (вкладка карточки инвентаря).
  applyFilter: () => set((state) => ({ filteredList: recompute(state) })),
  // Patch one already-loaded row in place (no network) so the table reflects a
  // panel action without a full refetch (полный refetch дёргает isLoading).
  patchRow: (recordId, patch) =>
    set((state) => ({
      filteredList: (state.filteredList || []).map((row) =>
        row.recordId === recordId ? { ...row, ...patch } : row,
      ),
    })),

  // --- Record-центричные операции (новый раздел) --------------------------------
  // Одна запись (строка + record без секретов + сверка) — страница записи и
  // префилл формы «Изменить».
  fetchRecord: async (recordId) => {
    const response = await fetch(`${API}/records/${recordId}`, {
      headers: authHeaders(),
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  },
  // Создать запись (verify-on-save). Ответ несёт блок «Инвентарь» (кандидат на
  // связь по серийнику) — список обновляет вызывающая форма после закрытия.
  createStandalone: async (body) => {
    return fetch(`${API}/standalone/parameters`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
  },
  // Пересохранить параметры любой записи (verify-on-save) по её id.
  saveRecordParameters: async (recordId, body) => {
    return fetch(`${API}/records/${recordId}/parameters`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
  },
  // Связать запись с карточкой инвентаря (шаг после проверки).
  linkInventory: async (recordId, clientDeviceId) => {
    return fetch(`${API}/records/${recordId}/link-inventory`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ clientDeviceId }),
    });
  },
  // Создать карточку инвентаря из данных записи и связать.
  createInventoryCard: async (recordId) => {
    return fetch(`${API}/records/${recordId}/create-inventory`, {
      method: "POST",
      headers: authHeaders(),
    });
  },
  connectRecord: async (recordId) => {
    const response = await fetch(`${API}/records/${recordId}/connect`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (response.ok) await get().fetch();
    return response;
  },
  disconnectRecord: async (recordId) => {
    const response = await fetch(`${API}/records/${recordId}/disconnect`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (response.ok) await get().fetch();
    return response;
  },
  // Удалить запись мониторинга (карточка инвентаря, если была, остаётся).
  deleteRecord: async (recordId) => {
    const response = await fetch(`${API}/records/${recordId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (response.ok) await get().fetch();
    return response;
  },

  // Применить считанные с устройства значения к связанной карточке инвентаря
  // (расхождения показывает секция «Мониторинг» карточки). Шлём только ИМЕНА
  // полей — значения сервер выводит сам из сохранённой записи.
  syncInventory: async (recordId, fields) =>
    fetch(`${API}/records/${recordId}/sync-inventory`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ fields }),
    }),

  // --- Отчёты и конфигурации (по id записи) --------------------------------------
  // Availability report (uptime / outage episodes) for one record. Returns the
  // report object for component-local state, or null on failure.
  fetchAvailability: async (recordId, days = 30) => {
    const response = await fetch(
      `${API}/records/${recordId}/availability?days=${days}`,
      { headers: authHeaders() },
    );
    if (!response.ok) return null;
    return response.json().catch(() => null);
  },
  // Fetch a device's stored artifacts (optionally filtered by type). Returns the
  // array for section-local state; not kept in the global store.
  fetchArtifacts: async (recordId, type) => {
    const suffix = type ? `?type=${type}` : "";
    const response = await fetch(
      `${API}/records/${recordId}/artifacts${suffix}`,
      { headers: authHeaders() },
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.artifacts) ? data.artifacts : [];
  },
  // Export the running config now (live SSH). The caller patches the row badge via
  // `patchRow` — a full refetch would toggle the list spinner.
  createExport: async (recordId) => {
    return fetch(`${API}/records/${recordId}/exports`, {
      method: "POST",
      headers: authHeaders(),
    });
  },
  // Delete a stored artifact. The caller patches the row badge via `patchRow`.
  deleteArtifact: async (recordId, artifactId) => {
    return fetch(`${API}/records/${recordId}/artifacts/${artifactId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  },
  // Save the config-export schedule + retention. The caller patches the row badge
  // via `patchRow`.
  saveSchedules: async (recordId, body) => {
    return fetch(`${API}/records/${recordId}/schedules`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
  },
  // 2FA step 1: ask the backend to email a one-time download code.
  requestDownloadCode: async (recordId, artifactId) => {
    return fetch(
      `${API}/records/${recordId}/artifacts/${artifactId}/download-code`,
      { method: "POST", headers: authHeaders() },
    );
  },
  // 2FA step 2: submit the emailed code; on success stream the file as a blob.
  downloadArtifact: async (recordId, artifactId, fileName, code) => {
    const response = await fetch(
      `${API}/records/${recordId}/artifacts/${artifactId}/download`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ code }),
      },
    );
    if (!response.ok) return response;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || "mikrotik";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return response;
  },
}));

export default useMikrotikDeviceFilterStore;

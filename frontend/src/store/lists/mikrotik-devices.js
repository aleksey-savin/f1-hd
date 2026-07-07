import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

const API = `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices`;

// Searchable text fields of a managed-device row.
const rowSearchFields = (item) => [
  item.displayName,
  item.host,
  item.serialNumber,
  item.currentFirmware,
  item.boardName,
  item.status,
  item.model?.name,
  item.model?.vendor,
  item.location?.name,
  item.company?.name,
];

// последовательно отсеивает устройства согласно активному поиску
const clientDeviceFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  // В таблице показываем только привязанные (настроенные) устройства. Не
  // привязанные (status === "notConfigured") остаются в originalList — из них
  // формируется список доступных для добавления через «+».
  return originalList
    .filter((item) => item.status !== "notConfigured")
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return rowSearchFields(item)
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(state.searchTerm);
      }
      return true;
    });
};

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

const getTime = (value) => (value ? new Date(value).getTime() : 0);

const handleSorting = (selected, list) => {
  if (!selected || !list.length) {
    return;
  }

  const sortedList = [...list];

  switch (selected.label) {
    case "По алфавиту":
      sortedList.sort((a, b) =>
        (a.displayName || "").localeCompare(b.displayName || "", "ru"),
      );
      break;

    case "Сначала новые":
      sortedList.sort(
        (a, b) =>
          getTime(b.lastSuccessfulConnectionAt) -
          getTime(a.lastSuccessfulConnectionAt),
      );
      break;

    case "Сначала старые":
      sortedList.sort(
        (a, b) =>
          getTime(a.lastSuccessfulConnectionAt) -
          getTime(b.lastSuccessfulConnectionAt),
      );
      break;

    default:
      break;
  }

  return sortedList;
};

const useMikrotikDeviceFilterStore = create((set, get) => ({
  searchTerm: "",
  sortingOptions: [
    { label: "По алфавиту" },
    { label: "Сначала новые" },
    { label: "Сначала старые" },
  ],
  sortBy: {
    label: "По алфавиту",
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
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(API, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });
    const data = await response.json();

    set({
      originalList: Array.isArray(data) ? data : [],
      isLoading: false,
    });
  },
  // Patch one already-loaded row in place (no network) so the table badge reflects
  // a panel action without a full refetch. A refetch toggles isLoading / isSorting,
  // and ListWrapper swaps its children (incl. the device Offcanvas) for a spinner —
  // which would close the panel. Touches only filteredList (what the table renders);
  // originalList reconciles on the next full fetch.
  patchRow: (recordId, patch) =>
    set((state) => ({
      filteredList: (state.filteredList || []).map((row) =>
        row.recordId === recordId ? { ...row, ...patch } : row,
      ),
    })),
  // Detach an inventory-backed device from management (delete its record), then
  // refresh. The ClientDevice returns to the "available" pool for re-adding.
  detach: async (clientDeviceId) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/${clientDeviceId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    if (response.ok) {
      await get().fetch();
    }
    return response;
  },
  // Create a standalone device (no inventory ClientDevice, e.g. Cloud Hosted
  // Router): verify-on-save, then refresh.
  createStandalone: async (body) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/standalone/parameters`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await get().fetch();
    }
    return response;
  },
  // Verify-on-save parameters (and company/label) of a standalone record.
  saveStandaloneParameters: async (recordId, body) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/standalone/${recordId}/parameters`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await get().fetch();
    }
    return response;
  },
  // Delete a standalone record entirely, then refresh.
  detachStandalone: async (recordId) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/standalone/${recordId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    if (response.ok) {
      await get().fetch();
    }
    return response;
  },
  // Verify-on-save connection parameters, then refresh the list.
  saveParameters: async (clientDeviceId, body) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/${clientDeviceId}/parameters`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await get().fetch();
    }
    return response;
  },
  // --- Backups & config exports (keyed by the Mikrotik record id) ---
  // Fetch a device's stored artifacts (optionally filtered by type). Returns the
  // array for panel-local state; not kept in the global store.
  fetchArtifacts: async (recordId, type) => {
    const { token } = getLocalStorageData();
    const suffix = type ? `?type=${type}` : "";
    const response = await fetch(
      `${API}/records/${recordId}/artifacts${suffix}`,
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.artifacts) ? data.artifacts : [];
  },
  // Export the running config now (live SSH). The caller patches the row badge via
  // `patchRow` — a full refetch would close the device panel (see `patchRow`).
  createExport: async (recordId) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/records/${recordId}/exports`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    return response;
  },
  // Delete a stored artifact. The caller patches the row badge via `patchRow`.
  deleteArtifact: async (recordId, artifactId) => {
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${API}/records/${recordId}/artifacts/${artifactId}`,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } },
    );
    return response;
  },
  // Save the config-export schedule + retention. The caller patches the row badge
  // via `patchRow`.
  saveSchedules: async (recordId, body) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/records/${recordId}/schedules`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    return response;
  },
  // 2FA step 1: ask the backend to email a one-time download code.
  requestDownloadCode: async (recordId, artifactId) => {
    const { token } = getLocalStorageData();
    return fetch(
      `${API}/records/${recordId}/artifacts/${artifactId}/download-code`,
      { method: "POST", headers: { Authorization: "Bearer " + token } },
    );
  },
  // 2FA step 2: submit the emailed code; on success stream the file as a blob.
  downloadArtifact: async (recordId, artifactId, fileName, code) => {
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${API}/records/${recordId}/artifacts/${artifactId}/download`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
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

export default useMikrotikDeviceFilterStore;

import { create } from "zustand";

import type { PersonalReportResponse } from "../../types/employeesReport";
import { getLocalStorageData } from "../../util/auth";
import { monthRange } from "../../util/period";

// Персональный отчёт: свой («Мой отчёт») или выбранного сотрудника (переход из
// сводной). userId держим в сторе — при смене сотрудника период сохраняется.
// Права проверяет сервер: чужой отчёт откроется только с полным правом.
const API = import.meta.env.VITE_API_ADDRESS;

type PersonalState = {
  from: string;
  to: string;
  /** null — свой отчёт. */
  userId: string | null;
  data: PersonalReportResponse | null;
  isLoading: boolean;
  error: string | null;
  /** 403 от сервера — чужой отчёт без права; экран показывает гейт. */
  isForbidden: boolean;
  fetch: () => void;
  setUser: (userId: string | null) => void;
  setPeriod: (patch: { from?: string; to?: string }) => void;
  resetPeriod: () => void;
};

type Getter = () => PersonalState;
type Setter = (partial: Partial<PersonalState>) => void;

let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter) => {
  const { from, to, userId } = get();
  if (!from || !to) return;

  const requestId = ++requestSeq;
  const { token } = getLocalStorageData();
  set({ isLoading: true });
  try {
    const url = new URL(`${API}/api/finances/personal-report-summary`, window.location.origin);
    url.search = new URLSearchParams({
      from,
      to,
      ...(userId ? { userId } : {}),
    }).toString();
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (response.status === 403) {
      if (requestId !== requestSeq) return;
      set({ isLoading: false, isForbidden: true, data: null });
      return;
    }
    if (!response.ok) throw new Error(`personal report ${response.status}`);
    const data = (await response.json()) as PersonalReportResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null, isForbidden: false });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Персональный отчёт не загрузился:", error);
    set({
      isLoading: false,
      error: "Не удалось загрузить отчёт. Проверьте соединение и повторите.",
    });
  }
};

const usePersonalReportStore = create<PersonalState>()((set, get) => ({
  ...monthRange(new Date()),
  userId: null,
  data: null,
  isLoading: false,
  error: null,
  isForbidden: false,

  fetch: () => doFetch(get, set),

  // Смена сотрудника (переход из сводной) — данные прошлого сбрасываем, иначе
  // на экране мелькнёт чужой отчёт
  setUser: (userId) => {
    if (get().userId === userId) return;
    set({ userId, data: null, isForbidden: false, error: null });
    doFetch(get, set);
  },

  setPeriod: (patch) => {
    set(patch);
    doFetch(get, set);
  },

  resetPeriod: () => {
    set(monthRange(new Date()));
    doFetch(get, set);
  },
}));

export default usePersonalReportStore;

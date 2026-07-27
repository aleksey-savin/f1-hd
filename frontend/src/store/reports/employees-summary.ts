import { create } from "zustand";

import type {
  EmployeesSummaryResponse,
  ReportPeriod,
} from "../../types/employeesReport";
import { getLocalStorageData } from "../../util/auth";
import { monthRange } from "../../util/period";

// Сводка по сотрудникам: часы, классы работ, переработки и доплата за период.
// Механика — как у аналитики (store/reports/companies-summary): загрузка сразу
// при открытии за текущий месяц, seq-guard от гонок листания, ошибка не
// сбрасывает уже показанные данные.
const API = import.meta.env.VITE_API_ADDRESS;

type SummaryState = {
  from: string;
  to: string;
  /** Учитывать только работы из согласованных отчётов по услугам. */
  approvedOnly: boolean;
  data: EmployeesSummaryResponse | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => void;
  setPeriod: (patch: Partial<Pick<ReportPeriod, "from" | "to">>) => void;
  resetPeriod: () => void;
  setApprovedOnly: (approvedOnly: boolean) => void;
};

type Getter = () => SummaryState;
type Setter = (partial: Partial<SummaryState>) => void;

let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter) => {
  const { from, to, approvedOnly } = get();
  if (!from || !to) return;

  const requestId = ++requestSeq;
  const { token } = getLocalStorageData();
  set({ isLoading: true });
  try {
    const url = new URL(`${API}/api/finances/employees-summary`);
    url.search = new URLSearchParams({
      from,
      to,
      ...(approvedOnly ? { approvedOnly: "true" } : {}),
    }).toString();
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`employees summary ${response.status}`);
    const data = (await response.json()) as EmployeesSummaryResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Сводка по сотрудникам не загрузилась:", error);
    set({
      isLoading: false,
      error: "Не удалось загрузить сводку. Проверьте соединение и повторите.",
    });
  }
};

const useEmployeesSummaryStore = create<SummaryState>()((set, get) => ({
  ...monthRange(new Date()),
  approvedOnly: false,
  data: null,
  isLoading: false,
  error: null,

  fetch: () => doFetch(get, set),

  setPeriod: (patch) => {
    set(patch);
    doFetch(get, set);
  },

  resetPeriod: () => {
    set(monthRange(new Date()));
    doFetch(get, set);
  },

  setApprovedOnly: (approvedOnly) => {
    set({ approvedOnly });
    doFetch(get, set);
  },
}));

export default useEmployeesSummaryStore;

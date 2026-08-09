import { create } from "zustand";

import type { EmployeesTrendResponse } from "../../types/employeesReport";
import { getLocalStorageData } from "../../util/auth";

// Режим «Динамика» отчёта «Сотрудники»: 12 месяцев по команде. Запрос тяжёлый
// (год работ всей организации + расчёт переработок по каждой), поэтому он
// живёт в своём сторе и уходит только при открытии режима, а не с загрузкой
// страницы. Метрика и выбор сотрудников — клиентские пивоты без запроса.
const API = import.meta.env.VITE_API_ADDRESS;

export type EmployeesTrendMetricKey =
  | "minutes"
  | "overtimeMinutes"
  | "worksCount"
  | "ticketsFinished"
  | "onSiteCount";

type TrendState = {
  months: number;
  approvedOnly: boolean;
  metric: EmployeesTrendMetricKey;
  data: EmployeesTrendResponse | null;
  isLoading: boolean;
  error: string | null;
  fetch: (options?: { approvedOnly?: boolean }) => void;
  setMetric: (metric: EmployeesTrendMetricKey) => void;
};

type Getter = () => TrendState;
type Setter = (partial: Partial<TrendState>) => void;

let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter) => {
  const { months, approvedOnly } = get();

  const requestId = ++requestSeq;
  const { token } = getLocalStorageData();
  set({ isLoading: true });
  try {
    const url = new URL(`${API}/api/finances/employees-trend`, window.location.origin);
    const params = new URLSearchParams({ months: String(months) });
    if (approvedOnly) params.set("approvedOnly", "true");
    url.search = params.toString();

    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`employees trend ${response.status}`);
    const data = (await response.json()) as EmployeesTrendResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Динамика по сотрудникам не загрузилась:", error);
    set({
      isLoading: false,
      error: "Не удалось загрузить динамику. Проверьте соединение и повторите.",
    });
  }
};

const useEmployeesTrendStore = create<TrendState>()((set, get) => ({
  months: 12,
  approvedOnly: false,
  metric: "minutes",
  data: null,
  isLoading: false,
  error: null,

  fetch: (options) => {
    // Переключатель «только согласованные» общий для всех режимов отчёта —
    // приходит из стора сводки при открытии режима
    if (options && options.approvedOnly !== get().approvedOnly) {
      set({ approvedOnly: options.approvedOnly });
    }
    doFetch(get, set);
  },

  setMetric: (metric) => set({ metric }),
}));

export default useEmployeesTrendStore;

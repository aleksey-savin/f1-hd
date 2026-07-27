import { create } from "zustand";

import type {
  TrendsGrouping,
  TrendsPreset,
  TrendsResponse,
} from "../../types/report";
import { getLocalStorageData } from "../../util/auth";

// Сегмент «Динамика» отчёта «Компании»: пресет периода + группировка, при
// «Произвольном» — две даты из шторки (запрос уходит, когда заданы обе).
// Выбор метрики и компаний — клиентский пивот по загруженным данным (без
// запроса), живёт здесь же, чтобы переживать переключение сегментов.
const API = import.meta.env.VITE_API_ADDRESS;

export type TrendsMetricKey =
  | "totalTime"
  | "totalTickets"
  | "onSiteCount"
  | "remoteCount"
  | "routineTime";

type TrendsParams = {
  preset: TrendsPreset;
  grouping: TrendsGrouping;
  startDate: string;
  endDate: string;
};

type TrendsState = TrendsParams & {
  metric: TrendsMetricKey;
  /** Явно выбранные компании; пусто — топ-5 автоматически. Максимум 5 (слоты
   *  палитры); новый выбор вытесняет самый старый. */
  selectedCompanies: string[];
  data: TrendsResponse | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => void;
  setParams: (patch: Partial<TrendsParams>) => void;
  setMetric: (metric: TrendsMetricKey) => void;
  setSelectedCompanies: (ids: string[]) => void;
};

type Getter = () => TrendsState;
type Setter = (partial: Partial<TrendsState>) => void;

let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter) => {
  const { preset, grouping, startDate, endDate } = get();
  if (preset === "custom" && (!startDate || !endDate)) return;

  const requestId = ++requestSeq;
  const { token } = getLocalStorageData();
  set({ isLoading: true });
  try {
    const params = new URLSearchParams({ period: preset, grouping });
    if (preset === "custom") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    const url = new URL(`${API}/api/report/companies/trends`);
    url.search = params.toString();
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`companies trends ${response.status}`);
    const data = (await response.json()) as TrendsResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Динамика по компаниям не загрузилась:", error);
    set({
      isLoading: false,
      error: "Не удалось загрузить динамику. Проверьте соединение и повторите.",
    });
  }
};

const useCompaniesTrendsStore = create<TrendsState>()((set, get) => ({
  preset: "12months",
  grouping: "month",
  startDate: "",
  endDate: "",
  metric: "totalTime",
  selectedCompanies: [],
  data: null,
  isLoading: false,
  error: null,

  fetch: () => doFetch(get, set),

  setParams: (patch) => {
    set(patch);
    doFetch(get, set);
  },

  setMetric: (metric) => set({ metric }),

  setSelectedCompanies: (ids) => set({ selectedCompanies: ids.slice(-5) }),
}));

export default useCompaniesTrendsStore;

import { useSearchParams } from "react-router";

import Segmented from "@/components/app/Segmented";

import SummarySegment from "../../components/Report/SummarySegment";
import TrendsSegment from "../../components/Report/TrendsSegment";

// «Аналитика» — первый отчёт на целевой системе (recharts + shadcn chart).
// Одна страница на два режима: «Сводка» (период месяцем/произвольно, KPI с
// дельтами, разрезы) и «Динамика» (пресеты диапазона, метрики по периодам).
// Канон «Архива»: сегмент несёт query (?view=trends — deep-link), состояние
// режимов живёт в своих сторах (store/reports/*) и переживает переключение;
// гейта между сегментами нет — оба эндпоинта под одними правами
// (canSeeAnalytics). Клиентский вид разруливает сервер (isClientView).

const Analytics = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const view = searchParams.get("view") === "trends" ? "trends" : "summary";

  const switchView = (value: string) => {
    setSearchParams(value === "trends" ? { view: "trends" } : {}, {
      replace: true,
    });
    // Смена query не меняет pathname — скролл-ресеты Root не срабатывают
    window.scrollTo(0, 0);
    document.querySelector(".mobile-shell__scroll")?.scrollTo(0, 0);
  };

  const segment = (
    <Segmented
      ariaLabel="Режим аналитики"
      options={[
        { value: "summary", label: "Сводка" },
        { value: "trends", label: "Динамика" },
      ]}
      value={view}
      onChange={switchView}
    />
  );

  return view === "trends" ? (
    <TrendsSegment segment={segment} />
  ) : (
    <SummarySegment segment={segment} />
  );
};

export default Analytics;

export function loader() {
  document.title = "Аналитика";
  return null;
}

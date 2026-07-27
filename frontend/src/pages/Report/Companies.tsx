import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";

import Segmented from "@/components/app/Segmented";

import SummarySegment from "../../components/Report/SummarySegment";
import TrendsSegment from "../../components/Report/TrendsSegment";
import useCompaniesSummaryStore from "../../store/reports/companies-summary";

// Отчёт «Компании» (бывшая «Аналитика»). Одна страница на два режима: «Сводка»
// (период месяцем/произвольно, KPI с дельтами, время и таблица по компаниям) и
// «Динамика» (пресеты диапазона, метрики по периодам). Канон «Архива»: сегмент
// несёт query (?view=trends — deep-link), состояние режимов живёт в своих
// сторах (store/reports/*) и переживает переключение. Второй уровень отчёта —
// карточка компании, третий — карточка подразделения; объём данных считает
// сервер (services/reportScope).

const Companies = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const defaultView = useCompaniesSummaryStore(
    (state) => state.data?.scope.defaultView ?? null,
  );

  const view = searchParams.get("view") === "trends" ? "trends" : "summary";

  // Доступен ровно один объект (своя компания или своё подразделение) — сразу
  // открываем его: список из одной строки ничего не сообщает
  useEffect(() => {
    if (view !== "summary" || !defaultView) return;
    const path =
      defaultView.level === "subdivision" && defaultView.subdivisionId
        ? `/report/companies/${defaultView.companyId}/subdivisions/${defaultView.subdivisionId}`
        : `/report/companies/${defaultView.companyId}`;
    navigate(path, { replace: true });
  }, [defaultView, view, navigate]);

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
      ariaLabel="Режим отчёта"
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

export default Companies;

export function loader() {
  document.title = "Компании";
  return null;
}

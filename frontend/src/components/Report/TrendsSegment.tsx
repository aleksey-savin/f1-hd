import { useEffect, type ReactNode } from "react";
import { RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import ChipSelect from "@/components/app/ChipSelect";
import { Eyebrow } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";
import { cn } from "@/lib/utils";

import useCompaniesTrendsStore, {
  type TrendsMetricKey,
} from "../../store/reports/companies-trends";
import type { TrendsGrouping, TrendsPreset } from "../../types/report";
import { msToHMS } from "../../util/time-helpers";

import EmptyReport from "./EmptyReport";
import FilterSheet from "./FilterSheet";
import MetricCards, { type MetricCard } from "./MetricCards";
import PageShell from "@/components/app/PageShell";
import TrendsChart, { type TrendsSeries } from "./TrendsChart";
import TrendsFilter from "./TrendsFilter";
import TrendsTable from "./TrendsTable";
import { deltaOf } from "./delta";
import {
  TRENDS_METRICS,
  aggregatePeriods,
  companiesByTotalTime,
  periodAxis,
} from "./trends";

// Сегмент «Динамика»: карточки метрик (сводка + переключатель графика) →
// главный график (топ-5 компаний + пунктирные «Прочие») → таблица периодов.
// Слоты палитры раздаёт базовый порядок компаний (по суммарному времени) —
// переключение метрики ничего не перекрашивает.

const PRESET_OPTIONS: { value: TrendsPreset; label: string }[] = [
  { value: "12months", label: "12 месяцев" },
  { value: "currentYear", label: "Текущий год" },
  { value: "lastYear", label: "Прошлый год" },
  { value: "custom", label: "Произвольный" },
];

const GROUPING_OPTIONS: { value: TrendsGrouping; label: string }[] = [
  { value: "month", label: "По месяцам" },
  { value: "quarter", label: "По кварталам" },
  { value: "week", label: "По неделям" },
];

const GROUPING_TITLE: Record<TrendsGrouping, string> = {
  month: "по месяцам",
  quarter: "по кварталам",
  week: "по неделям",
};

const TrendsSegment = ({ segment }: { segment: ReactNode }) => {
  const s = useCompaniesTrendsStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();

  useEffect(() => {
    s.fetch();
  }, []);

  const data = s.data;
  const metric =
    TRENDS_METRICS.find((candidate) => candidate.key === s.metric) ??
    TRENDS_METRICS[0];

  const toolbar = (
    <>
      {segment}
      <ChipSelect
        placeholder="Период"
        clearable={false}
        value={s.preset}
        options={PRESET_OPTIONS}
        onChange={(value) => {
          if (!value) return;
          s.setParams({ preset: value as TrendsPreset });
          // Произвольному диапазону нужны даты — сразу открываем шторку
          if (value === "custom") filterOffcanvas.handleShow();
        }}
      />
      <ChipSelect
        placeholder="Группировка"
        clearable={false}
        value={s.grouping}
        options={GROUPING_OPTIONS}
        onChange={(value) => {
          if (value) s.setParams({ grouping: value as TrendsGrouping });
        }}
      />
      {s.preset === "custom" && (
        <Button
          variant={s.startDate && s.endDate ? "success" : "outline"}
          size="icon"
          onClick={filterOffcanvas.handleShow}
          title="Фильтр"
          aria-label="Фильтр"
        >
          <RiFilter3Line />
        </Button>
      )}
    </>
  );

  let body: ReactNode;
  if (!data) {
    body = s.error ? (
      <AlertMessage
        variant="danger"
        message={
          <span className="flex flex-wrap items-center gap-3">
            {s.error}
            <Button variant="outline" size="xs" onClick={() => s.fetch()}>
              Повторить
            </Button>
          </span>
        }
      />
    ) : s.preset === "custom" && (!s.startDate || !s.endDate) ? (
      <EmptyReport
        title="Задайте диапазон"
        hint="Для произвольного периода укажите обе даты в фильтре — график построится сразу."
        action={
          <Button variant="outline" onClick={filterOffcanvas.handleShow}>
            Открыть фильтр
          </Button>
        }
      />
    ) : (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  } else if (data.data.length === 0) {
    body = (
      <EmptyReport
        title="Нет работ за период"
        hint="За выбранный диапазон не зафиксировано ни одной завершённой работы. Выберите другой период или группировку."
      />
    );
  } else {
    const axis = periodAxis(data);
    const aggregated = aggregatePeriods(data);
    const baseOrder = companiesByTotalTime(data);

    // Серии: явный выбор либо топ-5 базового порядка; остальные — «Прочие»
    const shown = s.selectedCompanies.length
      ? baseOrder.filter((companyTrends) =>
          s.selectedCompanies.includes(companyTrends.company._id),
        )
      : baseOrder.slice(0, 5);
    const shownIds = new Set(
      shown.map((companyTrends) => companyTrends.company._id),
    );
    const others = baseOrder.filter(
      (companyTrends) => !shownIds.has(companyTrends.company._id),
    );

    const series: TrendsSeries[] = shown.map((companyTrends, index) => ({
      dataKey: companyTrends.company._id,
      label: companyTrends.company.alias,
      color: `var(--chart-${index + 1})`,
    }));
    if (others.length > 0) {
      series.push({
        dataKey: "__other",
        label: `Прочие (${others.length})`,
        color: "var(--faint)",
        dashed: true,
      });
    }

    const chartData = axis.map((period, index) => {
      const row: Record<string, number | string> = {
        key: period.key,
        label: period.label,
      };
      for (const companyTrends of shown) {
        row[companyTrends.company._id] = metric.of(
          companyTrends.periods[index] ?? period,
        );
      }
      if (others.length > 0) {
        row.__other = others.reduce(
          (sum, companyTrends) =>
            sum + metric.of(companyTrends.periods[index] ?? period),
          0,
        );
      }
      return row;
    });

    // Карточки метрик — «Итого» по всей выборке
    const metricCards: MetricCard[] = TRENDS_METRICS.map((candidate) => {
      const values = aggregated.map((period) => candidate.of(period.totals));
      return {
        key: candidate.key,
        label: candidate.label,
        change: deltaOf(values[values.length - 1] ?? 0, values[0] ?? 0),
        spark: values,
      };
    });

    // Строка-контекст панели графика: среднее / макс / мин по выбранной метрике
    const metricValues = aggregated.map((period) => metric.of(period.totals));
    const formatMetric = (value: number) =>
      metric.isTime ? msToHMS(value) : String(Math.round(value));
    const average =
      metricValues.reduce((sum, value) => sum + value, 0) /
      Math.max(metricValues.length, 1);
    const maxIndex = metricValues.indexOf(Math.max(...metricValues));
    const minIndex = metricValues.indexOf(Math.min(...metricValues));

    const legend = (
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((line) => (
          <span
            key={line.dataKey}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            {line.dashed ? (
              <span
                aria-hidden
                className="w-3"
                style={{ borderTop: "2px dashed var(--faint)" }}
              />
            ) : (
              <span
                aria-hidden
                className="size-2.5 rounded-xs"
                style={{ background: line.color }}
              />
            )}
            {line.label}
          </span>
        ))}
      </span>
    );

    body = (
      <div className={cn("transition-opacity", s.isLoading && "opacity-60")}>
        {s.error && (
          <AlertMessage
            variant="danger"
            message={
              <span className="flex flex-wrap items-center gap-3">
                {s.error}
                <Button variant="outline" size="xs" onClick={() => s.fetch()}>
                  Повторить
                </Button>
              </span>
            }
          />
        )}

        <MetricCards
          metrics={metricCards}
          active={s.metric}
          onSelect={(key) => s.setMetric(key as TrendsMetricKey)}
        />

        <Eyebrow
          action={
            <span className="flex flex-wrap items-center gap-3">
              {legend}
              <ChipMultiCombobox
                placeholder="Компании: топ-5"
                searchPlaceholder="Найти компанию…"
                countLabel={(count: number) => `Компании: ${count}`}
                value={s.selectedCompanies}
                options={baseOrder.map((companyTrends) => ({
                  value: companyTrends.company._id,
                  label: companyTrends.company.alias,
                }))}
                onChange={(value: string[]) => s.setSelectedCompanies(value)}
              />
            </span>
          }
        >
          {metric.label} {GROUPING_TITLE[s.grouping]}
        </Eyebrow>
        <div className="rounded-xl border border-border bg-card p-5">
          {aggregated.length > 0 && (
            <div className="mb-3.5 text-xs text-faint tabular-nums">
              в среднем {formatMetric(average)} за период · макс —{" "}
              {aggregated[maxIndex]?.label} (
              {formatMetric(metricValues[maxIndex] ?? 0)}) · мин —{" "}
              {aggregated[minIndex]?.label} (
              {formatMetric(metricValues[minIndex] ?? 0)})
            </div>
          )}
          <TrendsChart
            data={chartData}
            series={series}
            isTime={metric.isTime}
            grouping={s.grouping}
          />
        </div>

        <Eyebrow count={aggregated.length}>По периодам</Eyebrow>
        <div className="overflow-x-auto rounded-xl border border-border bg-card px-2 py-1.5">
          <TrendsTable periods={aggregated} />
        </div>
      </div>
    );
  }

  return (
    <PageShell title="Компании" toolbar={toolbar}>
      <FilterSheet>
        <TrendsFilter />
      </FilterSheet>
      {body}
    </PageShell>
  );
};

export default TrendsSegment;

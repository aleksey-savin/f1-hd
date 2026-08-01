import { useEffect } from "react";

import AlertMessage from "@/components/app/AlertMessage";
import { Eyebrow } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import useEmployeesTrendStore, {
  type EmployeesTrendMetricKey,
} from "../../store/reports/employees-trend";
import type {
  EmployeeTrendSeries,
  TrendMonth,
} from "../../types/employeesReport";

import EmptyReport from "./EmptyReport";
import MetricCards, { type MetricCard } from "./MetricCards";
import TrendsChart, { type TrendsSeries } from "./TrendsChart";
import { deltaOf } from "./delta";
import { formatMinutes, fullName } from "./work-format";

// Режим «Динамика»: 12 месяцев по команде. Карточка метрики одновременно
// показывает изменение и выбирает серию главного графика — тот же паттерн, что
// в «Компаниях» (компоненты общие).

// Пять слотов палитры: серий на графике не больше пяти, хвост — «Прочие»
const MAX_SERIES = 5;

type Metric = {
  key: EmployeesTrendMetricKey;
  label: string;
  isTime: boolean;
  of: (month: TrendMonth) => number;
  /** null — метрика не раскладывается по людям (заявки и выезды считаются по команде). */
  ofEmployee: ((month: EmployeeTrendSeries["months"][number]) => number) | null;
};

const METRICS: readonly Metric[] = [
  {
    key: "minutes",
    label: "Отработано",
    isTime: true,
    of: (m) => m.minutes,
    ofEmployee: (m) => m.minutes,
  },
  {
    key: "overtimeMinutes",
    label: "Переработки",
    isTime: true,
    of: (m) => m.overtimeMinutes,
    ofEmployee: (m) => m.overtimeMinutes,
  },
  {
    key: "worksCount",
    label: "Работы",
    isTime: false,
    of: (m) => m.worksCount,
    ofEmployee: (m) => m.worksCount,
  },
  {
    key: "ticketsFinished",
    label: "Заявки",
    isTime: false,
    of: (m) => m.ticketsFinished,
    // Заявки считаются по команде целиком: у работы может быть несколько
    // заявок, и разложить их по людям без двойного счёта нельзя
    ofEmployee: null,
  },
  {
    key: "onSiteCount",
    label: "Выезды",
    isTime: false,
    of: (m) => m.onSite.count,
    ofEmployee: null,
  },
] as const;

const EmployeesTrendsSegment = ({
  approvedOnly,
}: {
  approvedOnly: boolean;
}) => {
  const s = useEmployeesTrendStore();

  useEffect(() => {
    s.fetch({ approvedOnly });
  }, [approvedOnly]);

  if (!s.data) {
    return s.error ? (
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
    ) : (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const { months, byEmployee } = s.data;

  if (months.every((month) => month.worksCount === 0)) {
    return (
      <EmptyReport
        title="Нет данных за год"
        hint="За последние 12 месяцев не зафиксировано ни одной завершённой работы."
      />
    );
  }

  const metric = METRICS.find((item) => item.key === s.metric) ?? METRICS[0];
  const ofEmployee = metric.ofEmployee;

  const cards: MetricCard[] = METRICS.map((item) => {
    const values = months.map(item.of);
    return {
      key: item.key,
      label: item.label,
      change: deltaOf(values.at(-1) ?? 0, values[0] ?? 0),
      spark: values,
    };
  });

  const top = byEmployee.slice(0, MAX_SERIES);
  const rest = byEmployee.slice(MAX_SERIES);

  const series: TrendsSeries[] = ofEmployee
    ? [
        ...top.map((employee, index) => ({
          dataKey: employee.employee._id,
          label: fullName(employee.employee),
          color: `var(--chart-${index + 1})`,
        })),
        ...(rest.length > 0
          ? [
              {
                dataKey: "__other",
                label: `Прочие (${rest.length})`,
                color: "var(--faint)",
                dashed: true,
              },
            ]
          : []),
      ]
    : [{ dataKey: "__team", label: "Вся команда", color: "var(--chart-1)" }];

  const chartData = months.map((month, index) => {
    const row: Record<string, number | string> = {
      key: month.month,
      label: month.label,
    };
    if (ofEmployee) {
      for (const employee of top) {
        const point = employee.months[index];
        row[employee.employee._id] = point ? ofEmployee(point) : 0;
      }
      if (rest.length > 0) {
        row.__other = rest.reduce((sum, employee) => {
          const point = employee.months[index];
          return sum + (point ? ofEmployee(point) : 0);
        }, 0);
      }
    } else {
      row.__team = metric.of(month);
    }
    return row;
  });

  const format = (value: number) =>
    metric.isTime ? formatMinutes(value) : String(value);

  return (
    <div className={cn("transition-opacity", s.isLoading && "opacity-60")}>
      <MetricCards
        metrics={cards}
        active={s.metric}
        onSelect={(key) => s.setMetric(key as EmployeesTrendMetricKey)}
      />

      <Eyebrow
        action={
          !ofEmployee && (
            <span className="text-sm font-normal text-faint">
              по команде целиком — по людям эта метрика не раскладывается
            </span>
          )
        }
      >
        {metric.label} по месяцам
      </Eyebrow>
      <div className="rounded-xl border border-border bg-card p-5">
        {/* Отчёт считает в минутах, а график по умолчанию — в миллисекундах:
            единицы задаём форматтерами, ось короче тултипа */}
        <TrendsChart
          data={chartData}
          series={series}
          isTime={false}
          grouping="month"
          valueFormatter={format}
          axisFormatter={(value) =>
            metric.isTime ? `${Math.round(value / 60)} ч` : String(value)
          }
        />
      </div>

      <Eyebrow count={months.length}>По месяцам</Eyebrow>
      <div className="overflow-x-auto rounded-xl border border-border bg-card px-2 py-1.5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Месяц</TableHead>
              <TableHead className="text-right">Отработано</TableHead>
              <TableHead className="text-right">Δ</TableHead>
              <TableHead className="text-right">Переработки</TableHead>
              <TableHead className="text-right">Работы</TableHead>
              <TableHead className="text-right">Заявки</TableHead>
              <TableHead className="text-right">Выезды</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((month, index) => {
              const previous = months[index - 1];
              const delta = previous ? month.minutes - previous.minutes : null;
              return (
                <TableRow key={month.month}>
                  <TableCell className="whitespace-nowrap">
                    {month.label}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatMinutes(month.minutes)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      delta === null && "text-faint",
                      delta !== null &&
                        (delta >= 0 ? "text-accent-text" : "text-destructive"),
                    )}
                  >
                    {delta === null
                      ? "—"
                      : `${delta >= 0 ? "↑" : "↓"} ${formatMinutes(Math.abs(delta))}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMinutes(month.overtimeMinutes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {month.worksCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {month.ticketsFinished}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {month.onSite.count}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default EmployeesTrendsSegment;

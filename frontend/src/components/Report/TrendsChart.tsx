import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import type { TrendsGrouping } from "../../types/report";
import { msToHMS } from "../../util/time-helpers";

// Линии динамики: топ-компании цветными сериями + пунктирные «Прочие».
// Точки — только на наведённом периоде (activeDot); тултип отсортирован по
// значению. Одна ось Y; подписи осей рецессивные.
export type TrendsSeries = {
  dataKey: string;
  label: string;
  color: string;
  dashed?: boolean;
};

const MONTH_SHORT = new Intl.DateTimeFormat("ru-RU", { month: "short" });

const tickLabel = (key: string, grouping: TrendsGrouping, first: boolean) => {
  const [year, month, day] = key.split("-").map(Number);
  const shortYear = String(year).slice(2);
  if (grouping === "quarter") {
    return `${Math.floor((month - 1) / 3) + 1} кв ${shortYear}`;
  }
  if (grouping === "week") {
    return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`;
  }
  const monthLabel = MONTH_SHORT.format(new Date(year, month - 1, 1)).replace(
    ".",
    "",
  );
  // Год — у первого тика и на смене года
  return first || month === 1 ? `${monthLabel} ${shortYear}` : monthLabel;
};

const TrendsChart = ({
  data,
  series,
  isTime,
  grouping,
  valueFormatter,
  axisFormatter,
}: {
  /** Строки по периодам: { key, label, [dataKey серии]: значение }. */
  data: Record<string, number | string>[];
  series: TrendsSeries[];
  isTime: boolean;
  grouping: TrendsGrouping;
  /** Своя единица (отчёт «Сотрудники» считает в минутах, а не в мс). */
  valueFormatter?: (value: number) => string;
  /** Подписи оси Y — короче тултипа, иначе ось съедает половину графика. */
  axisFormatter?: (value: number) => string;
}) => {
  const config = Object.fromEntries(
    series.map((line) => [line.dataKey, { label: line.label, color: line.color }]),
  ) satisfies ChartConfig;

  const formatValue = (value: number) =>
    valueFormatter ? valueFormatter(value) : isTime ? msToHMS(value) : String(value);

  return (
    <ChartContainer
      config={config}
      className="tw:aspect-auto tw:w-full"
      style={{ height: 280 }}
    >
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="key"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={18}
          tick={{ fontSize: 11 }}
          tickFormatter={(value: string, index: number) =>
            tickLabel(value, grouping, index === 0)
          }
        />
        <YAxis
          width={44}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11 }}
          tickFormatter={(value: number) =>
            axisFormatter
              ? axisFormatter(value)
              : isTime
                ? `${Math.round(value / 3_600_000)} ч`
                : String(value)
          }
        />
        <ChartTooltip
          itemSorter={(item) => -Number(item.value ?? 0)}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) =>
                (payload?.[0]?.payload as { label?: string } | undefined)
                  ?.label ?? null
              }
              formatter={(value, name, item) => (
                <>
                  <span
                    aria-hidden
                    className="tw:mt-0.5 tw:size-2.5 tw:shrink-0 tw:rounded-xs"
                    style={{ background: item.color }}
                  />
                  <span className="tw:flex tw:flex-1 tw:items-center tw:justify-between tw:gap-4 tw:leading-none">
                    <span className="tw:text-muted-foreground">
                      {config[name as string]?.label ?? name}
                    </span>
                    <span className="tw:font-medium tw:text-foreground tw:tabular-nums">
                      {formatValue(Number(value))}
                    </span>
                  </span>
                </>
              )}
            />
          }
        />
        {series.map((line) => (
          <Line
            key={line.dataKey}
            type="linear"
            dataKey={line.dataKey}
            stroke={`var(--color-${line.dataKey})`}
            strokeWidth={2}
            strokeDasharray={line.dashed ? "5 4" : undefined}
            dot={false}
            activeDot={{ r: 3.5, stroke: "var(--card)", strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
};

export default TrendsChart;

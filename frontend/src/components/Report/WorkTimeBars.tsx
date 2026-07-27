import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import { formatMinutes } from "./work-format";

// Время работ столбиками: «в графике» + переработка сверху. Одним компонентом
// рисуются дневной разрез периода и помесячная динамика за год — вопрос один
// и тот же («сколько отработано и сколько сверх графика»), меняется только ось.
export type TimeBar = {
  key: string;
  label: string;
  minutes: number;
  overtimeMinutes: number;
  /** Выходной/незанятый — столбик приглушается. */
  dim?: boolean;
};

const chartConfig = {
  base: { label: "В графике", color: "var(--chart-1)" },
  overtime: { label: "Переработка", color: "var(--warning)" },
} satisfies ChartConfig;

const WorkTimeBars = ({
  bars,
  height = 200,
  tickEvery = 1,
}: {
  bars: TimeBar[];
  height?: number;
  /** Подписывать каждый N-й столбик (дни — не все). */
  tickEvery?: number;
}) => {
  const data = bars.map((bar, index) => ({
    ...bar,
    // Переработка входит в отработанное время — рисуем её частью столбика,
    // а не поверх, иначе сумма читалась бы вдвое
    base: Math.max(0, bar.minutes - bar.overtimeMinutes),
    overtime: Math.min(bar.minutes, bar.overtimeMinutes),
    index,
  }));

  return (
    <ChartContainer
      config={chartConfig}
      className="tw:aspect-auto tw:w-full"
      style={{ height }}
    >
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          interval={tickEvery - 1}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          width={40}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11 }}
          tickFormatter={(value: number) => `${Math.round(value / 60)} ч`}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name, item) =>
                Number(value) === 0 ? null : (
                  <>
                    <span
                      aria-hidden
                      className="tw:mt-0.5 tw:size-2.5 tw:shrink-0 tw:rounded-xs"
                      style={{ background: item.color }}
                    />
                    <span className="tw:flex tw:flex-1 tw:items-center tw:justify-between tw:gap-4 tw:leading-none">
                      <span className="tw:text-muted-foreground">
                        {chartConfig[name as keyof typeof chartConfig]?.label ??
                          name}
                      </span>
                      <span className="tw:font-medium tw:text-foreground tw:tabular-nums">
                        {formatMinutes(Number(value))}
                      </span>
                    </span>
                  </>
                )
              }
            />
          }
        />
        <Bar dataKey="base" stackId="time" fill="var(--color-base)" />
        <Bar
          dataKey="overtime"
          stackId="time"
          fill="var(--color-overtime)"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
};

export default WorkTimeBars;

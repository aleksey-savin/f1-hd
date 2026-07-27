import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import { msToHMS } from "../../util/time-helpers";

// Горизонтальный стек-бар времени по классам работ (компании / сотрудники /
// подразделения — один компонент). Ось значений скрыта: сумму подписывает
// LabelList у конца полосы (часть палитры на белом ниже контраста 3:1 —
// подписи значений обязательны). «Прочие» — одна серая полоса-хвост вне
// классов. Высота — от числа строк, инлайн-стилем (aspect-контейнер в
// нескроллящемся мобильном шелле схлопнулся бы).
export type StackedTimeRow = {
  key: string;
  name: string;
  onSite: number;
  remote: number;
  routineTask: number;
  /** Сумма «Прочих» — только у строки-хвоста. */
  other?: number;
};

const chartConfig = {
  onSite: { label: "Выезды", color: "var(--chart-1)" },
  remote: { label: "Удалённо", color: "var(--chart-2)" },
  routineTask: { label: "Регламент", color: "var(--chart-3)" },
  other: { label: "Прочие", color: "var(--faint)" },
} satisfies ChartConfig;

const ROW_HEIGHT = 32;
const CLASS_KEYS = ["onSite", "remote", "routineTask"] as const;

const StackedTimeBars = ({ rows }: { rows: StackedTimeRow[] }) => {
  const data = rows.map((row) => ({
    ...row,
    other: row.other ?? 0,
    total: row.onSite + row.remote + row.routineTask + (row.other ?? 0),
  }));

  return (
    <ChartContainer
      config={chartConfig}
      className="tw:aspect-auto tw:w-full"
      style={{ height: data.length * ROW_HEIGHT + 12 }}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 56, bottom: 4, left: 0 }}
        barSize={16}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 13 }}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name, item) =>
                // Нулевые классы в тултипе не показываем (у строки «Прочие»
                // классов нет, у обычных строк нет «Прочих»)
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
                        {msToHMS(Number(value))}
                      </span>
                    </span>
                  </>
                )
              }
            />
          }
        />
        {CLASS_KEYS.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="time"
            fill={`var(--color-${key})`}
            stroke="var(--card)"
            strokeWidth={1}
          />
        ))}
        <Bar
          dataKey="other"
          stackId="time"
          fill="var(--color-other)"
          fillOpacity={0.45}
          radius={[0, 4, 4, 0]}
        >
          <LabelList
            dataKey="total"
            position="right"
            offset={8}
            formatter={(value) => msToHMS(Number(value))}
            className="tw:fill-muted-foreground"
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
};

export default StackedTimeBars;

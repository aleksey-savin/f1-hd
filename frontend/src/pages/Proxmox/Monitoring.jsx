import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import Segmented from "@/components/app/Segmented";
import Combobox from "@/components/app/Combobox";
import { Button } from "@/components/ui/button";
import { formatDayMonth, formatTime } from "@/util/format-date";
import {
  Section,
  Feedback,
  Properties,
  date,
  duration,
  percent,
  idOf,
} from "./shared";
import { ROOT } from "./data";
export function Metrics({ id, kind }) {
  const fetcher = useFetcher(),
    [period, setPeriod] = useState("day"),
    [metric, setMetric] = useState(kind === "storages" ? "disk" : "cpu");
  const path = `${ROOT}/resources/${id}?section=metrics&timeframe=${period}`;
  useEffect(() => {
    fetcher.load(path);
  }, [path]);
  const raw = fetcher.data?.items || fetcher.data?.data || [];
  const rows = (Array.isArray(raw) ? raw : []).map((row) => {
    const value =
      metric === "cpu"
        ? row.cpu
        : metric === "mem"
          ? (row.mem ?? row.memused)
          : (row.disk ?? row.used);
    return {
      time: row.time * 1000,
      value:
        value == null
          ? null
          : metric === "cpu"
            ? value * 100
            : value / 1024 ** 3,
    };
  });
  const label =
    metric === "cpu"
      ? "Нагрузка CPU"
      : metric === "mem"
        ? "Использование RAM"
        : "Занято на диске";
  const unit = metric === "cpu" ? "%" : " ГБ";
  const values = rows.map((row) => row.value).filter((v) => v != null);
  const formatValue = (value) =>
    value == null
      ? "—"
      : `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(value)}${unit}`;
  return (
    <Section title="Графики" id="metrics">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Метрика"
          fit
          value={metric}
          onChange={setMetric}
          options={
            kind === "storages"
              ? [{ value: "disk", label: "Диски" }]
              : [
                  { value: "cpu", label: "CPU" },
                  { value: "mem", label: "RAM" },
                  { value: "disk", label: "Диски" },
                ]
          }
        />
        <div className="w-36">
          <Combobox
            ariaLabel="Период графика"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "hour", label: "Последний час" },
              { value: "day", label: "24 часа" },
              { value: "week", label: "7 дней" },
              { value: "month", label: "30 дней" },
            ]}
          />
        </div>
      </div>
      {fetcher.data?.error ? (
        <>
          <Feedback data={fetcher.data} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetcher.load(path)}
          >
            Повторить загрузку
          </Button>
        </>
      ) : values.length ? (
        <>
          <ChartContainer
            config={{ value: { label, color: "var(--chart-1)" } }}
            className="h-56 w-full"
          >
            <AreaChart
              data={rows}
              margin={{ left: 0, right: 8, top: 10, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                minTickGap={36}
                tickFormatter={(v) =>
                  period === "hour" || period === "day"
                    ? formatTime(v)
                    : formatDayMonth(v)
                }
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v) => Math.round(v)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(v) => date(v)}
                    formatter={(v) => formatValue(v)}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-value)"
                fill="var(--color-value)"
                fillOpacity={0.12}
                connectNulls={false}
              />
            </AreaChart>
          </ChartContainer>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>
              Последнее:{" "}
              <strong className="text-foreground">
                {formatValue(values.at(-1))}
              </strong>
            </span>
            <span>
              Максимум:{" "}
              <strong className="text-foreground">
                {formatValue(Math.max(...values))}
              </strong>
            </span>
            <span>
              {label}, {unit.trim()}
            </span>
          </div>
        </>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {fetcher.state !== "idle"
            ? "Загружаем статистику…"
            : "За выбранный период наблюдений пока нет."}
        </p>
      )}
    </Section>
  );
}
export function History({ id, type }) {
  const fetcher = useFetcher(),
    path = `${ROOT}/resources/${id}?section=${type}`;
  useEffect(() => {
    fetcher.load(path);
  }, [path]);
  const data = fetcher.data;
  return (
    <Section
      title={type === "events" ? "Журнал событий" : "Доступность за 30 дней"}
      id={type}
    >
      {data?.error ? (
        <>
          <Feedback data={data} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetcher.load(path)}
          >
            Повторить загрузку
          </Button>
        </>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : type === "availability" ? (
        <>
          <Properties
            items={[
              [
                "Доступность",
                data.availability == null
                  ? "—"
                  : `${new Intl.NumberFormat("ru", { maximumFractionDigits: 2 }).format(data.availability < 100 ? Math.min(99.99, data.availability) : data.availability)}%`,
              ],
              ["Полнота наблюдений", percent(data.coverage)],
              ["Подтверждённый простой", duration(data.downMs)],
              ["Нет данных", duration(data.unknownMs)],
              ...(data.excludedMs > 0
                ? [["Исключено из расчёта", duration(data.excludedMs)]]
                : []),
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            {date(data.from)} — {date(data.to)}. Пропуски наблюдений не
            считаются простоем.
          </p>
          {(data.episodes || []).length > 0 && (
            <div className="mt-4 divide-y divide-border-soft border-t border-border-soft">
              {data.episodes.map((entry) => (
                <div key={entry.startedAt} className="py-3 text-sm">
                  <span className="font-medium">
                    {entry.title || "Недоступность"}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {date(entry.startedAt)} ·{" "}
                    {entry.endedAt
                      ? `${duration(new Date(entry.endedAt) - new Date(entry.startedAt))}, восстановлено ${date(entry.endedAt)}`
                      : "Продолжается"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="divide-y divide-border-soft">
            {(data.items || []).map((entry) => (
              <div
                key={idOf(entry)}
                className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-4 sm:gap-4"
              >
                <time className="text-xs text-muted-foreground">
                  {date(entry.at || entry.createdAt)}
                </time>
                <p className="text-sm sm:col-span-3">
                  {entry.message || entry.title || "Событие мониторинга"}
                </p>
              </div>
            ))}
          </div>
          {!data.items?.length && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Событий пока нет. Здесь появятся изменения состояния и действия
              сотрудников.
            </p>
          )}
          {data.total > data.items?.length && (
            <p className="mt-4 text-xs text-muted-foreground">
              Показаны последние {data.items.length} из {data.total} событий.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

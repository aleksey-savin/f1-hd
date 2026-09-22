import { useEffect, useState } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { Panel, Eyebrow } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";

import UptimeBar from "./UptimeBar";
import {
  formatDurationShort,
  formatUptime,
  reportSegments,
  uptimeToneClass,
} from "./meta";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { formatDate, formatShortDate } from "../../util/format-date";

const PERIODS = [
  { value: "1", label: "24 ч", buckets: 24 },
  { value: "7", label: "7 дн", buckets: 28 },
  { value: "30", label: "30 дн", buckets: 30 },
  { value: "90", label: "90 дн", buckets: 45 },
];

// Секция «Доступность» страницы записи: переключатель периода, стат-плитки,
// лента и журнал простоев с заявками эпизодов. Точность границ — интервал
// опроса (5 минут), об этом честно сказано под лентой.
const AvailabilitySection = ({ recordId }) => {
  const fetchAvailability = useMikrotikDeviceFilterStore(
    (state) => state.fetchAvailability,
  );

  const [period, setPeriod] = useState("30");
  const [report, setReport] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchAvailability(recordId, Number(period));
      if (!cancelled) setReport(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [recordId, period]);

  const buckets =
    PERIODS.find((entry) => entry.value === period)?.buckets || 30;
  const segments = reportSegments(report, buckets);

  const stats = [
    {
      label: "доступность",
      value: formatUptime(report?.uptimePct) || "—",
      className: uptimeToneClass(report?.uptimePct),
    },
    {
      label: "простой суммарно",
      value: report?.downtimeMs ? formatDurationShort(report.downtimeMs) : "—",
    },
    {
      label: report?.outageCount === 1 ? "инцидент" : "инцидентов",
      value: report ? report.outageCount : "—",
    },
    {
      label: "самый долгий",
      value: report?.longestMs ? formatDurationShort(report.longestMs) : "—",
    },
  ];

  return (
    <>
      <Eyebrow
        id="availability"
        action={
          <Segmented
            ariaLabel="Период отчёта"
            options={PERIODS.map(({ value, label }) => ({ value, label }))}
            value={period}
            onChange={setPeriod}
          />
        }
      >
        Доступность
      </Eyebrow>
      <Panel>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border-soft bg-accent/40 px-3.5 py-2.5"
            >
              <div
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  stat.className,
                )}
              >
                {stat.value}
              </div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {segments && (
          <>
            <UptimeBar segments={segments} size="lg" className="mt-4" />
            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs text-faint">
              <span>
                {report?.effectiveFrom && formatShortDate(report.effectiveFrom)}
              </span>
              <span className="hidden md:block">
                Точность границ — до 5 минут (интервал опроса)
              </span>
              <span>сейчас</span>
            </div>
          </>
        )}

        <div className="mt-4">
          {report && report.outages.length === 0 && (
            <div className="text-sm text-faint">
              Инцидентов за период не было.
            </div>
          )}
          {report && report.outages.length > 0 && (
            <>
              <div className="flex gap-3.5 border-b border-border-soft pb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">
                <span className="w-44 flex-none">Начало</span>
                <span className="hidden w-44 flex-none md:block">Конец</span>
                <span className="flex-1">Длительность</span>
                <span>Заявка</span>
              </div>
              {report.outages.map((outage) => (
                <div
                  key={outage.id}
                  className="flex items-baseline gap-3.5 border-b border-border-soft py-2 text-sm tabular-nums last:border-b-0"
                >
                  <span className="w-44 flex-none">
                    {formatDate(outage.startedAt)}
                  </span>
                  <span className="hidden w-44 flex-none md:block">
                    {outage.ongoing ? (
                      <span className="font-semibold text-destructive">
                        продолжается
                      </span>
                    ) : (
                      formatDate(outage.endedAt)
                    )}
                  </span>
                  <span className="flex-1">
                    {formatDurationShort(outage.durationMs)}
                  </span>
                  {outage.ticketNum ? (
                    <Link
                      to={`/tickets/${outage.ticketNum}`}
                      className="font-semibold text-accent-text no-underline hover:underline"
                    >
                      {outage.ticketNum}
                    </Link>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </Panel>
    </>
  );
};

export default AvailabilitySection;

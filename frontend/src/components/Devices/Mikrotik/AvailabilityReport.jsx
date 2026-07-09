import { useEffect, useState } from "react";
import { Link } from "react-router";

import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";

import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";
import { formatDate, formatDayMonthTime } from "../../../util/format-date";

export const PERIODS = [
  { days: 1, label: "24 ч" },
  { days: 7, label: "7 дн" },
  { days: 30, label: "30 дн" },
  { days: 90, label: "90 дн" },
];

// "1 д 4 ч 12 мин" / "35 мин" / "меньше минуты" (зеркалит бэкенд).
export const durationRu = (ms) => {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  if (totalMinutes < 1) return "меньше минуты";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} д`);
  if (hours) parts.push(`${hours} ч`);
  if (minutes) parts.push(`${minutes} мин`);
  return parts.join(" ");
};

// Порог «хорошо/терпимо/плохо» для процента доступности.
export const uptimeToneClass = (pct) => {
  if (pct == null) return "text-body-secondary";
  if (pct >= 99) return "text-success";
  if (pct >= 95) return "text-warning";
  return "text-danger";
};

// Сегменты ленты-таймлайна по отчёту: серый «до подключения к мониторингу»,
// зелёные интервалы связи, красные простои (границы клампятся к окну, перекрытия
// сливаются — как в KPI на бэкенде).
export const buildStripSegments = (report) => {
  const from = new Date(report.from).getTime();
  const to = new Date(report.to).getTime();
  const effectiveFrom = new Date(report.effectiveFrom).getTime();
  if (to <= from) return [];

  const segments = [];
  if (effectiveFrom > from) {
    segments.push({ type: "idle", ms: effectiveFrom - from });
  }

  const intervals = (report.outages || [])
    .map((outage) => [
      Math.max(new Date(outage.startedAt).getTime(), effectiveFrom),
      Math.min(outage.endedAt ? new Date(outage.endedAt).getTime() : to, to),
    ])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  const hasOngoing = (report.outages || []).some((outage) => outage.ongoing);
  let cursor = effectiveFrom;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({
        type: "up",
        ms: start - cursor,
        from: cursor,
        to: start,
      });
    }
    segments.push({
      type: "down",
      ms: end - start,
      from: start,
      to: end,
      ongoing: hasOngoing && end >= to,
    });
    cursor = end;
  }
  if (cursor < to) {
    segments.push({ type: "up", ms: to - cursor, from: cursor, to });
  }
  return segments;
};

const segmentTitle = (segment) => {
  if (segment.type === "idle") return "До подключения к мониторингу";
  const range = `${formatDayMonthTime(segment.from)} — ${
    segment.ongoing ? "сейчас" : formatDayMonthTime(segment.to)
  }`;
  return segment.type === "down"
    ? `Не в сети · ${range} · ${durationRu(segment.ms)}`
    : `В сети · ${range} · ${durationRu(segment.ms)}`;
};

// Лента доступности: пропорциональные зелёные/красные сегменты на всём окне.
export const UptimeStrip = ({ segments, height = 14 }) => (
  <div className="mikrotik-uptime" style={{ height }}>
    {segments.map((segment, index) => (
      <div
        key={index}
        className={[
          "mikrotik-uptime__seg",
          `mikrotik-uptime__seg--${segment.type}`,
          segment.ongoing ? "mikrotik-uptime__seg--ongoing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ flexGrow: Math.max(segment.ms, 1) }}
        title={segmentTitle(segment)}
      />
    ))}
  </div>
);

const StatTile = ({ label, value, toneClass = "" }) => (
  <div className="border rounded-3 px-3 py-2 text-center flex-fill">
    <div className={`fs-4 fw-semibold ${toneClass}`}>{value}</div>
    <div className="small text-body-secondary">{label}</div>
  </div>
);

// Отчёт о доступности устройства: KPI, лента-таймлайн и журнал простоев за
// выбранный период. Простой считается от момента потери связи (первый неудачный
// опрос), а не от порога создания заявки.
const AvailabilityReport = ({ recordId, defaultDays = 30 }) => {
  const fetchAvailability = useMikrotikDeviceFilterStore(
    (state) => state.fetchAvailability,
  );

  const [days, setDays] = useState(defaultDays);
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!recordId) return undefined;
    let ignore = false;
    setIsLoading(true);
    setError(false);
    (async () => {
      const data = await fetchAvailability(recordId, days);
      if (ignore) return;
      if (data) setReport(data);
      else setError(true);
      setIsLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [recordId, days, fetchAvailability]);

  if (!recordId) return null;

  if (isLoading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" size="sm" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <Alert variant="light" className="mb-0">
        Не удалось загрузить отчёт о доступности.
      </Alert>
    );
  }

  const segments = buildStripSegments(report);
  const noData = report.uptimePct == null;

  return (
    <div>
      <div className="d-flex justify-content-end mb-3">
        <ButtonGroup size="sm">
          {PERIODS.map((period) => (
            <Button
              key={period.days}
              variant={days === period.days ? "primary" : "outline-secondary"}
              onClick={() => setDays(period.days)}
            >
              {period.label}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {noData ? (
        <Alert variant="light" className="mb-0">
          Недостаточно данных — устройство подключено к управлению совсем
          недавно. Отчёт появится после первых проверок.
        </Alert>
      ) : (
        <>
          <div className="d-flex flex-wrap gap-2 mb-3">
            <StatTile
              label="Доступность"
              value={`${report.uptimePct} %`}
              toneClass={uptimeToneClass(report.uptimePct)}
            />
            <StatTile
              label="Простой суммарно"
              value={
                report.downtimeMs > 0 ? durationRu(report.downtimeMs) : "0 мин"
              }
            />
            <StatTile label="Инцидентов" value={report.outageCount} />
            <StatTile
              label="Самый долгий"
              value={report.longestMs > 0 ? durationRu(report.longestMs) : "—"}
            />
          </div>

          <UptimeStrip segments={segments} />
          <div className="d-flex justify-content-between small text-body-secondary mt-1 mb-3">
            <span>{formatDayMonthTime(report.effectiveFrom)}</span>
            <span>сейчас</span>
          </div>

          {report.outages.length === 0 ? (
            <div className="text-body-secondary small mb-2">
              Инцидентов за период не зафиксировано.
            </div>
          ) : (
            <Table responsive hover size="sm" className="align-middle mb-2">
              <thead>
                <tr className="text-body-secondary">
                  <th>Начало</th>
                  <th>Конец</th>
                  <th>Длительность</th>
                  <th>Заявка</th>
                </tr>
              </thead>
              <tbody>
                {report.outages.map((outage) => (
                  <tr key={outage.id}>
                    <td className="text-nowrap">
                      {formatDate(outage.startedAt)}
                    </td>
                    <td className="text-nowrap">
                      {outage.ongoing ? (
                        <Badge bg="danger" className="fw-normal">
                          продолжается
                        </Badge>
                      ) : (
                        formatDate(outage.endedAt)
                      )}
                    </td>
                    <td className="text-nowrap">
                      {durationRu(outage.durationMs)}
                    </td>
                    <td>
                      {outage.ticketNum ? (
                        <Link to={`/tickets/${outage.ticketNum}`}>
                          {outage.ticketNum}
                        </Link>
                      ) : (
                        <span className="text-body-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <div className="small text-body-secondary">
            Точность границ — до 5 минут (интервал опроса).
          </div>
        </>
      )}
    </div>
  );
};

export default AvailabilityReport;

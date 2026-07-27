import StatTile, { StatTileDelta } from "@/components/app/StatTile";
import { cn } from "@/lib/utils";

import type { ReportTotals } from "../../types/report";
import { msToHMS } from "../../util/time-helpers";

import { deltaOf } from "./delta";

// KPI-ряд сводки: значения выбранного периода + дельты к предыдущему периоду
// той же длины (totals/prev считает бэкенд, проценты — фронт). У сотрудников
// плиток четыре («Среднее время» выводится из имеющихся данных), в клиентском
// виде — три (по согласованному макету).
const HINT = "к прошлому периоду";

// «по 517 работам», «по 21 работе» — дательный падеж
const worksDative = (count: number) => {
  const tail = count % 10;
  const teens = count % 100;
  return tail === 1 && teens !== 11 ? "работе" : "работам";
};

const KpiRow = ({
  totals,
  prev,
  busy = false,
  showAverage = true,
}: {
  totals: ReportTotals;
  prev: ReportTotals;
  busy?: boolean;
  showAverage?: boolean;
}) => {
  const average = totals.totalWorks > 0 ? totals.totalTime / totals.totalWorks : 0;
  const prevAverage = prev.totalWorks > 0 ? prev.totalTime / prev.totalWorks : 0;

  return (
    <div
      className={cn(
        "tw:grid tw:grid-cols-2 tw:gap-3 tw:xl:gap-4",
        showAverage ? "tw:xl:grid-cols-4" : "tw:md:grid-cols-3",
      )}
    >
      <StatTile
        label="Время работ"
        busy={busy}
        value={msToHMS(totals.totalTime)}
        delta={
          <StatTileDelta
            {...deltaOf(totals.totalTime, prev.totalTime)}
            hint={HINT}
          />
        }
        footer={`Выезды ${msToHMS(totals.onSite.time)} · Удалённо ${msToHMS(
          totals.remote.time,
        )} · Регламент ${msToHMS(totals.routineTask.time)}`}
      />
      <StatTile
        label="Заявки"
        busy={busy}
        value={totals.totalTickets}
        delta={
          <StatTileDelta
            {...deltaOf(totals.totalTickets, prev.totalTickets)}
            hint={HINT}
          />
        }
        footer="уникальные, по работам периода"
      />
      <StatTile
        label="Работы"
        busy={busy}
        value={totals.totalWorks}
        delta={
          <StatTileDelta
            {...deltaOf(totals.totalWorks, prev.totalWorks)}
            hint={HINT}
          />
        }
        footer={`Выезды ${totals.onSite.count} · Удалённо ${totals.remote.count} · Регламент ${totals.routineTask.count}`}
      />
      {showAverage && (
        <StatTile
          label="Среднее время"
          busy={busy}
          value={msToHMS(average)}
          delta={<StatTileDelta {...deltaOf(average, prevAverage)} hint={HINT} />}
          footer={`по ${totals.totalWorks} ${worksDative(totals.totalWorks)}`}
        />
      )}
    </div>
  );
};

export default KpiRow;

import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import Segmented from "@/components/app/Segmented";
import StatTile from "@/components/app/StatTile";
import UptimeBar from "@/components/Mikrotik/UptimeBar";
import { Button } from "@/components/ui/button";
import { ROOT } from "./data";
import { Section, Feedback, date, duration, percent } from "./shared";

export default function AvailabilityPanel({ id, item }) {
  const fetcher = useFetcher(),
    [days, setDays] = useState("30");
  const path = `${ROOT}/resources/${id}?section=availability&days=${days}`;
  useEffect(() => {
    fetcher.load(path);
  }, [path]);
  const data = fetcher.data;
  return (
    <Section
      title="Доступность"
      id="availability"
      action={
        <Segmented
          ariaLabel="Период доступности"
          fit
          value={days}
          onChange={setDays}
          options={["1", "7", "30", "90"].map((value) => ({
            value,
            label: value === "1" ? "24 ч" : `${value} дн`,
          }))}
        />
      }
    >
      {data?.error ? (
        <>
          <Feedback data={data} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetcher.load(path)}
          >
            Повторить загрузку
          </Button>
        </>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Загружаем доступность…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label="Доступность"
              value={percent(data.availability)}
              busy={fetcher.state !== "idle"}
            />
            <StatTile
              label="Полнота наблюдений"
              value={percent(data.coverage)}
              busy={fetcher.state !== "idle"}
            />
            <StatTile
              label="Подтверждённый простой"
              value={duration(data.downMs)}
              busy={fetcher.state !== "idle"}
            />
            <StatTile
              label="Инциденты"
              value={data.episodes?.length || 0}
              busy={fetcher.state !== "idle"}
            />
          </div>
          <UptimeBar segments={data.segments} size="lg" className="mt-5" />
          <div className="mt-2 flex justify-between text-xs text-faint">
            <span>{days === "1" ? "24 часа" : `${days} дней`} назад</span>
            <span>{date(data.to)}</span>
          </div>
          {item.kind === "guest" && !item.expectedRunning && (
            <p className="mt-3 text-sm text-muted-foreground">
              Для этой ВМ не задана постоянная работа: её время исключается из
              расчёта доступности.
            </p>
          )}
          <div className="mt-4 divide-y divide-border-soft border-t border-border-soft pt-3">
            {data.episodes?.length ? (
              data.episodes.map((episode) => (
                <div
                  key={episode.startedAt}
                  className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    {date(episode.startedAt)} —{" "}
                    {episode.ongoing ? "продолжается" : date(episode.endedAt)}
                  </span>
                  <span className="text-muted-foreground">
                    {duration(episode.durationMs)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Подтверждённых простоев за период нет.
              </p>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

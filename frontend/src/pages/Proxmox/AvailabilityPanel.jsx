import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import Segmented from "@/components/app/Segmented";
import SettingRow from "@/components/app/SettingRow";
import { Switch } from "@/components/ui/switch";
import UptimeBar from "@/components/Mikrotik/UptimeBar";
import { Button } from "@/components/ui/button";
import { ROOT } from "./data";
import { Section, Feedback, date, duration, percent } from "./shared";

export default function AvailabilityPanel({
  id,
  item,
  canManage,
  saving,
  onExpectedRunningChange,
}) {
  const fetcher = useFetcher(),
    [days, setDays] = useState("30");
  const path = `${ROOT}/resources/${id}?section=availability&days=${days}`;
  const excluded = item.kind === "guest" && !item.expectedRunning;
  useEffect(() => {
    if (!excluded) fetcher.load(path);
  }, [path, excluded]);
  const data = fetcher.data;
  return (
    <Section
      title="Доступность"
      id="availability"
      action={
        !excluded && (
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
        )
      }
    >
      {item.kind === "guest" && (
        <SettingRow
          className="mb-4 border-b border-border-soft px-0 pt-0"
          title="ВМ должна работать постоянно"
          hint="Остановка этой ВМ считается проблемой доступности."
          htmlFor="proxmox-expected"
        >
          <Switch
            id="proxmox-expected"
            checked={Boolean(item.expectedRunning)}
            disabled={!canManage || saving || item.template}
            onCheckedChange={onExpectedRunningChange}
          />
        </SettingRow>
      )}
      {excluded ? (
        <p className="text-sm text-muted-foreground">
          Для этой ВМ не задана постоянная работа: её время исключается из
          расчёта доступности.
        </p>
      ) : data?.error ? (
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
          <dl
            className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4"
            aria-busy={fetcher.state !== "idle"}
          >
            {[
              ["Доступность", percent(data.availability)],
              ["Полнота наблюдений", percent(data.coverage)],
              [
                "Подтверждённый простой",
                data.downMs === 0 ? "0 мин" : duration(data.downMs),
              ],
              ["Инциденты", data.episodes?.length || 0],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-2 text-base font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <UptimeBar segments={data.segments} size="lg" className="mt-5" />
          <div className="mt-2 flex justify-between text-xs text-faint">
            <span>{days === "1" ? "24 часа" : `${days} дней`} назад</span>
            <span>{date(data.to)}</span>
          </div>
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

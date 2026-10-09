import { useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";

import { Button } from "@/components/ui/button";
import { Panel, Eyebrow, Section, SectionEditLink } from "@/components/app/Panel";

import {
  plannedSlotSet,
  plannedSummary,
  quietLabel,
  slotLevels,
} from "./activity-format";
import WeekGrid, { WeekLegend } from "./WeekGrid";
import { catalogCity } from "../../util/timezone-catalog";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Строка «подпись — значение» секции (в две колонки, на телефоне — друг под
// другом). Свой вид, а не app/PropRow: у того обязательная плитка-иконка.
const Row = ({ label, children }) => (
  <div className="grid gap-x-3 gap-y-0.5 border-t border-border-soft py-2 text-sm first:border-t-0 first:pt-0 md:grid-cols-[12rem_minmax(0,1fr)]">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="m-0 tabular-nums">{children}</dd>
  </div>
);

/**
 * Секция «Активность» страницы записи: плановые отключения устройства,
 * ближайшие тихие часы и неделя по часам (сетка появляется, когда накоплено
 * две недели данных). Окна правятся в своей шторке — карандаш в метке.
 *
 * Над строками — предложение окна: система видит повторяющиеся ночные простои
 * и предлагает оформить их как плановые; сама она ничего не подавляет.
 */
const ActivitySection = ({ row, canManage }) => {
  const fetchActivity = useMikrotikDeviceFilterStore((state) => state.fetchActivity);
  const hidePlannedSuggestion = useMikrotikDeviceFilterStore(
    (state) => state.hidePlannedSuggestion,
  );
  const revalidator = useRevalidator();

  const [activity, setActivity] = useState(null);
  const [hidden, setHidden] = useState(false);

  // Окна приходят из loader'а страницы; после сохранения в шторке он
  // перечитывается, и профиль запрашивается заново вместе с ним.
  const windowsKey = JSON.stringify(row.plannedOffline || []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchActivity(row.recordId);
      if (!cancelled) setActivity(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.recordId, windowsKey]);

  const summary = plannedSummary(row.plannedOffline);
  const quiet = activity?.quiet
    ? quietLabel(activity.quiet, activity.timezone)
    : null;
  const suggestion = !hidden && canManage ? activity?.suggestion : null;

  const planned = plannedSlotSet(row.plannedOffline);
  // День недели «сегодня» в поясе организации — в нём нарезана сетка.
  const today = activity?.timezone
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
        new Date().toLocaleDateString("en-US", {
          timeZone: activity.timezone,
          weekday: "short",
        }),
      )
    : null;
  const city = activity?.timezone ? catalogCity(activity.timezone) : null;

  const hide = async () => {
    setHidden(true);
    await hidePlannedSuggestion(row.recordId);
    revalidator.revalidate();
  };

  return (
    <Section>
      <Eyebrow
        id="activity"
        action={
          canManage && (
            <SectionEditLink to="planned-offline" label="Плановые отключения" />
          )
        }
      >
        Активность
      </Eyebrow>
      <Panel>
        {suggestion && (
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2.5 rounded-lg border border-primary/35 bg-primary/5 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-72">
              <div className="text-sm font-semibold">
                Похоже на отключение по расписанию
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {suggestion.matched} ночей из {suggestion.total} устройство было
                не в сети примерно с {suggestion.start} до {suggestion.end}.
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button asChild size="xs">
                <Link to="planned-offline" state={{ suggestion }}>
                  Задать окно
                </Link>
              </Button>
              <Button variant="ghost" size="xs" onClick={hide}>
                Скрыть
              </Button>
            </div>
          </div>
        )}

        <dl className="m-0">
          <Row label="Плановое отключение">
            {summary || <span className="text-faint">Не задано</span>}
          </Row>
          {quiet && (
            <Row label="Тихие часы">
              {activity.quiet.current ? `Сейчас, ${quiet}` : capitalize(quiet)}
              <div className="text-xs text-faint">
                ближайшее время с наименьшей сетевой активностью
              </div>
            </Row>
          )}
        </dl>

        {activity?.slots && (
          <>
            <WeekGrid
              levels={slotLevels(activity.slots)}
              planned={planned}
              quietSlots={activity.quiet?.slots}
              today={today}
            />
            <WeekLegend withPlanned={planned.size > 0} />
            <div className="mt-2.5 text-xs text-faint">
              Медиана по неделям наблюдения. Время по поясу организации
              {city ? `: ${city}` : ""}.
            </div>
          </>
        )}
      </Panel>
    </Section>
  );
};

export default ActivitySection;

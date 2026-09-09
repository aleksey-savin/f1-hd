import { toZonedTime } from "date-fns-tz";

import {
  Eyebrow,
  Panel,
  Section,
  SectionEditLink,
} from "@/components/app/Panel";
import ClientTime from "@/components/app/ClientTime";
import { SCHEDULE_DAYS } from "@/components/app/ScheduleEditor";
import { cn } from "@/lib/utils";

import { getLocalStorageData } from "../../../util/auth";
import { orgTimezone } from "../../../util/timezone-display";
import WorkStatusText from "../WorkStatusText";

// График работы: живая фраза статуса + сетка недели (как на карточке услуги).
// Сегодняшний день подсвечен, тонкая полоска внизу ячейки — сколько рабочего
// дня прошло. Часы графика — настенное время В ПОЯСЕ КОМПАНИИ; если он не
// задан, берётся зона организации (как считает util/get-working-status).
// Дни — из общего каталога (app/ScheduleEditor): свой словарь тут уже жил
const WEEK = SCHEDULE_DAYS.map(([, key, short]) => [short, key]);

const toMinutes = (value) => {
  const [hours, minutes] = String(value || "")
    .split(":")
    .map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes)
    ? hours * 60 + minutes
    : null;
};

// Ключ сегодняшнего дня и доля прошедшего рабочего дня (0–100 | null).
const getToday = (schedule, zone) => {
  const timezone = zone || getLocalStorageData().timezone;
  const now = toZonedTime(new Date(), timezone);
  const key = WEEK[(now.getDay() + 6) % 7][1];
  const day = schedule?.[key];
  if (!day?.isWorking) return { key, progress: null };

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (day.is24hours) return { key, progress: (nowMinutes / (24 * 60)) * 100 };

  const start = toMinutes(day.start);
  const end = toMinutes(day.end);
  if (start === null || end === null || end <= start)
    return { key, progress: null };
  const progress = ((nowMinutes - start) / (end - start)) * 100;
  return { key, progress: Math.min(100, Math.max(0, progress)) };
};

const ScheduleSection = ({
  workSchedule,
  hasSchedule,
  timezone,
  canManage,
  id,
}) => {
  const today = hasSchedule ? getToday(workSchedule, timezone) : { key: null };

  return (
    <Section>
      {/* Карандаш — второй вход в ту же форму, открытую на своей секции: график
          правится только в ней (см. ux-ui-guide, «Секции карточки показывают,
          правит форма») */}
      <Eyebrow
        id={id}
        action={
          canManage ? (
            <SectionEditLink to="update#schedule" label="График работы" />
          ) : undefined
        }
      >
        График работы
      </Eyebrow>
      <Panel>
        {!hasSchedule ? (
          <div className="text-sm text-muted-foreground">
            График не указан — укажите его в форме компании, и карточка начнёт
            показывать живой статус «открыто/закрыто».
          </div>
        ) : (
          <>
            <div className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <WorkStatusText
                workSchedule={workSchedule}
                timezone={timezone}
                verbose
              />
              {/* Явно, в каком поясе читать часы ниже */}
              <ClientTime
                clientTimezone={{
                  timezone: timezone || orgTimezone(),
                  source: timezone ? "company" : "global",
                }}
                always
                className="text-xs"
              />
            </div>
            <div className="grid grid-cols-7 gap-2 max-md:grid-cols-4">
              {WEEK.map(([label, key]) => {
                const day = workSchedule?.[key];
                const working = day?.isWorking;
                const isToday = key === today.key;
                const text = day?.is24hours
                  ? "24 ч"
                  : working
                    ? `${day.start}–${day.end}`
                    : "—";
                return (
                  <div
                    key={key}
                    className={cn(
                      "relative rounded-lg border px-2 py-2 pb-3 text-center",
                      working
                        ? "border-border-soft bg-accent/40"
                        : "border-border-soft",
                      isToday && "border-primary/45 bg-primary/10",
                    )}
                  >
                    <div
                      className={cn(
                        "text-xs font-bold tracking-wider uppercase",
                        isToday ? "text-accent-text" : "text-faint",
                      )}
                    >
                      {label}
                    </div>
                    <div
                      className={cn(
                        "mt-1 text-sm",
                        working
                          ? "font-semibold tabular-nums"
                          : "font-medium text-faint",
                      )}
                    >
                      {text}
                    </div>
                    {isToday && today.progress !== null && (
                      <div
                        role="img"
                        aria-label={`Прошло ${Math.round(today.progress)}% рабочего дня`}
                        title={`Прошло ${Math.round(today.progress)}% рабочего дня`}
                        className="absolute inset-x-2 bottom-1 h-0.5 overflow-hidden rounded-full bg-primary/20"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${today.progress}%`,
                            background: "var(--ws-st-office)",
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>
    </Section>
  );
};

export default ScheduleSection;

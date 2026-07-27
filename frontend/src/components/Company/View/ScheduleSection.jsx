import { toZonedTime } from "date-fns-tz";

import { Eyebrow, Panel } from "@/components/app/Panel";
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
  const [hours, minutes] = String(value || "").split(":").map(Number);
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

const ScheduleSection = ({ workSchedule, hasSchedule, timezone, id }) => {
  const today = hasSchedule ? getToday(workSchedule, timezone) : { key: null };

  return (
    <>
      <Eyebrow id={id}>График работы</Eyebrow>
      <Panel>
        {!hasSchedule ? (
          <div className="tw:text-sm tw:text-muted-foreground">
            График не указан — укажите его в форме компании, и карточка начнёт
            показывать живой статус «открыто/закрыто».
          </div>
        ) : (
          <>
            <div className="tw:mb-3.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1">
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
                className="tw:text-xs"
              />
            </div>
            <div className="tw:grid tw:grid-cols-7 tw:gap-2 tw:max-md:grid-cols-4">
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
                      "tw:relative tw:rounded-lg tw:border tw:px-2 tw:py-2 tw:pb-3 tw:text-center",
                      working
                        ? "tw:border-border-soft tw:bg-accent/40"
                        : "tw:border-border-soft",
                      isToday && "tw:border-primary/45 tw:bg-primary/10",
                    )}
                  >
                    <div
                      className={cn(
                        "tw:text-[0.65rem] tw:font-bold tw:tracking-wider tw:uppercase",
                        isToday ? "tw:text-accent-text" : "tw:text-faint",
                      )}
                    >
                      {label}
                    </div>
                    <div
                      className={cn(
                        "tw:mt-1 tw:text-sm",
                        working
                          ? "tw:font-semibold tw:tabular-nums"
                          : "tw:font-medium tw:text-faint",
                      )}
                    >
                      {text}
                    </div>
                    {isToday && today.progress !== null && (
                      <div
                        role="img"
                        aria-label={`Прошло ${Math.round(today.progress)}% рабочего дня`}
                        title={`Прошло ${Math.round(today.progress)}% рабочего дня`}
                        className="tw:absolute tw:inset-x-2 tw:bottom-1 tw:h-0.5 tw:overflow-hidden tw:rounded-full tw:bg-primary/20"
                      >
                        <div
                          className="tw:h-full tw:rounded-full"
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
    </>
  );
};

export default ScheduleSection;

import { useState } from "react";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiFileCopyLine,
  RiDeleteBinLine,
} from "react-icons/ri";
import { SCHEDULE_DAYS, emptyDay } from "@/components/app/ScheduleEditor";
import Field from "@/components/app/Field";
import Combobox, { MultiCombobox } from "@/components/app/Combobox";
import TimeInput from "@/components/app/TimeInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type {
  ScheduleDay,
  ScheduleInterval,
  WeekSchedule,
} from "@/types/teamSchedule";
import {
  dayIntervals,
  withIntervals,
  changeInterval,
  removeInterval,
  addPlaceChange,
  copyScheduleDays,
  dayIntervalsError,
  intervalMinutes,
} from "@/util/work-schedule";
import { DayPlaceSummary } from "./WorkScheduleView";

export default function WorkScheduleEditor({
  schedule,
  onChange,
  remoteOnly = false,
}: {
  schedule: WeekSchedule;
  onChange: (schedule: WeekSchedule) => void;
  remoteOnly?: boolean;
}) {
  const [open, setOpen] = useState<string | null>("Monday");
  const [adding, setAdding] = useState(false);
  const [changeAt, setChangeAt] = useState("");
  const [changePlace, setChangePlace] =
    useState<ScheduleInterval["place"]>("office");
  const [copying, setCopying] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [copied, setCopied] = useState("");
  const options = [
    { value: "office", label: "В офисе", disabled: remoteOnly },
    { value: "remote", label: "На удалёнке" },
  ];
  const dayOf = (key: string): ScheduleDay => schedule[key] || emptyDay();
  const setDay = (key: string, day: ScheduleDay) => {
    onChange({ ...schedule, [key]: day });
    setCopied("");
  };
  const select = (key: string, value: boolean) => {
    setOpen(value ? key : null);
    setAdding(false);
    setCopying(false);
    setCopied("");
    setTargets([]);
  };

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Укажите, с какого до какого времени и где вы работаете. Если место
        меняется в течение дня — добавьте интервал.
      </p>
      <div className="divide-y divide-border-soft rounded-lg border border-border px-3 sm:px-4">
        {SCHEDULE_DAYS.map(([label, key]) => {
          const day = dayOf(key);
          const rows = dayIntervals(day, remoteOnly);
          const expanded = open === key;
          const error = dayIntervalsError(day);
          const validChange =
            Boolean(changeAt) &&
            !error &&
            addPlaceChange(day, changeAt, changePlace) !== day;
          const windows = intervalMinutes(day, rows);
          return (
            <Collapsible
              key={key}
              open={expanded}
              onOpenChange={(value) => select(key, value)}
            >
              <div className="flex items-start gap-3 py-3.5">
                <Checkbox
                  aria-label={`${label}: рабочий день`}
                  checked={day.isWorking}
                  className="mt-1"
                  onCheckedChange={(value) => {
                    setDay(key, { ...day, isWorking: value === true });
                    if (value === true) select(key, true);
                  }}
                />
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Расписание: ${label}`}
                    className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-3 border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 space-y-1.5">
                      <span className="block text-sm font-semibold">
                        {label}
                      </span>
                      {!expanded &&
                        (day.isWorking ? (
                          <DayPlaceSummary day={day} remoteOnly={remoteOnly} />
                        ) : (
                          <span className="text-sm text-faint">Выходной</span>
                        ))}
                    </span>
                    {expanded ? (
                      <RiArrowUpSLine className="mt-1 shrink-0 text-muted-foreground" />
                    ) : (
                      <RiArrowDownSLine className="mt-1 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                {day.isWorking ? (
                  <div className="space-y-3 pb-4 sm:pl-7">
                    {rows.map((row, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1fr_1fr_32px] items-end gap-x-2 gap-y-2 sm:grid-cols-[110px_110px_1fr_32px]"
                      >
                        <Field
                          label="С"
                          htmlFor={`${key}-start-${index}`}
                          className="mb-0"
                        >
                          <TimeInput
                            id={`${key}-start-${index}`}
                            value={row.start}
                            readOnly={index > 0 || day.is24hours}
                            className={
                              index > 0 || day.is24hours
                                ? "border-transparent bg-muted"
                                : undefined
                            }
                            title={
                              index > 0
                                ? "Совпадает с окончанием предыдущего интервала"
                                : undefined
                            }
                            onChange={(event) =>
                              setDay(
                                key,
                                changeInterval(day, index, {
                                  start: event.target.value,
                                }),
                              )
                            }
                          />
                        </Field>
                        <Field
                          label={
                            windows[index].end >= 1440 && !day.is24hours
                              ? "До (+1 день)"
                              : "До"
                          }
                          htmlFor={`${key}-end-${index}`}
                          className="mb-0"
                        >
                          <TimeInput
                            id={`${key}-end-${index}`}
                            value={row.end}
                            readOnly={
                              day.is24hours && index === rows.length - 1
                            }
                            className={
                              day.is24hours && index === rows.length - 1
                                ? "border-transparent bg-muted"
                                : undefined
                            }
                            onChange={(event) =>
                              setDay(
                                key,
                                changeInterval(day, index, {
                                  end: event.target.value,
                                }),
                              )
                            }
                          />
                        </Field>
                        <Field
                          label="Место работы"
                          htmlFor={`${key}-place-${index}`}
                          className="col-span-2 row-start-2 mb-0 sm:col-span-1 sm:row-start-auto"
                        >
                          <Combobox
                            id={`${key}-place-${index}`}
                            options={options}
                            value={row.place}
                            onChange={(place) =>
                              setDay(
                                key,
                                changeInterval(day, index, {
                                  place: place as ScheduleInterval["place"],
                                }),
                              )
                            }
                            clearable={false}
                            disabled={remoteOnly}
                          />
                        </Field>
                        {rows.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="col-start-3 row-start-1 mb-1 sm:col-start-4"
                            aria-label={`Удалить интервал ${index + 1}: ${label}`}
                            onClick={() =>
                              setDay(key, removeInterval(day, index))
                            }
                          >
                            <RiDeleteBinLine />
                          </Button>
                        )}
                      </div>
                    ))}
                    {error && (
                      <p role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                    {rows.length > 1 && (
                      <p className="text-xs text-muted-foreground">
                        Если изменить «До», следующая строка начнётся с этого
                        времени.
                      </p>
                    )}
                    {adding ? (
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="mb-3 text-sm font-semibold">
                          С какого времени меняется место работы?
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <Field
                            label="Время"
                            htmlFor={`${key}-change-at`}
                            className="mb-0"
                          >
                            <TimeInput
                              id={`${key}-change-at`}
                              value={changeAt}
                              onChange={(event) =>
                                setChangeAt(event.target.value)
                              }
                            />
                          </Field>
                          <Field
                            label="Место работы"
                            htmlFor={`${key}-change-place`}
                            className="mb-0"
                          >
                            <Combobox
                              id={`${key}-change-place`}
                              options={options}
                              value={remoteOnly ? "remote" : changePlace}
                              onChange={(value) =>
                                setChangePlace(
                                  value as ScheduleInterval["place"],
                                )
                              }
                              clearable={false}
                              disabled={remoteOnly}
                            />
                          </Field>
                        </div>
                        {changeAt && !validChange && (
                          <p className="mt-2 text-sm text-destructive">
                            Укажите время внутри рабочего дня:{" "}
                            {day.is24hours
                              ? "24 часа"
                              : `${day.start}–${day.end}`}
                            .
                          </p>
                        )}
                        <div className="mt-3 flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!validChange}
                            onClick={() => {
                              setDay(
                                key,
                                addPlaceChange(
                                  day,
                                  changeAt,
                                  remoteOnly ? "remote" : changePlace,
                                ),
                              );
                              setAdding(false);
                              setChangeAt("");
                            }}
                          >
                            Добавить
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setAdding(false)}
                          >
                            Отменить добавление
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rows.length >= 24 || Boolean(error)}
                        onClick={() => {
                          setAdding(true);
                          setChangeAt("");
                          setChangePlace(
                            remoteOnly || rows.at(-1)?.place === "office"
                              ? "remote"
                              : "office",
                          );
                        }}
                      >
                        <RiAddLine /> Добавить интервал
                      </Button>
                    )}
                    {copying ? (
                      <div className="rounded-lg border border-border p-3">
                        <Field
                          label="В какие дни скопировать расписание?"
                          htmlFor={`${key}-copy-targets`}
                        >
                          <MultiCombobox
                            id={`${key}-copy-targets`}
                            value={targets}
                            onChange={setTargets}
                            options={SCHEDULE_DAYS.filter(
                              ([, target]) => target !== key,
                            ).map(([name, value]) => ({ label: name, value }))}
                          />
                        </Field>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!targets.length || Boolean(error)}
                            onClick={() => {
                              onChange(
                                copyScheduleDays(schedule, key, targets),
                              );
                              setCopying(false);
                              setCopied(
                                `Скопировано: ${SCHEDULE_DAYS.filter(
                                  ([, target]) => targets.includes(target),
                                )
                                  .map(([, , short]) => short)
                                  .join(", ")}.`,
                              );
                            }}
                          >
                            Применить
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setCopying(false)}
                          >
                            Отменить копирование
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(error)}
                        onClick={() => {
                          setCopying(true);
                          setAdding(false);
                          setTargets([]);
                        }}
                      >
                        <RiFileCopyLine /> Скопировать в другие дни
                      </Button>
                    )}
                    {copied && (
                      <p role="status" className="text-sm text-accent-text">
                        {copied}
                      </p>
                    )}
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        aria-label={`${label}: круглосуточно`}
                        checked={day.is24hours}
                        onCheckedChange={(value) =>
                          setDay(
                            key,
                            withIntervals({ ...day, is24hours: value }, [
                              {
                                start: value ? "00:00" : "09:00",
                                end: value ? "00:00" : "18:00",
                                place: rows[0]?.place || "office",
                              },
                            ]),
                          )
                        }
                      />
                      24 часа
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Рабочий день:{" "}
                      {day.is24hours ? "24 часа" : `${day.start}–${day.end}`}.
                      Перерыв вычитается один раз.
                    </p>
                  </div>
                ) : (
                  <p className="pb-4 text-sm text-faint sm:pl-7">
                    Выходной. Включите рабочий день, чтобы задать расписание.
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Ручной статус сохраняется до ночного сброса в 02:30.
      </p>
    </div>
  );
}

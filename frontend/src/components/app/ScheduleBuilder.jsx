import { useEffect, useState } from "react";
import {
  RiCheckLine,
  RiCodeSSlashLine,
  RiEqualizer2Line,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiTimeLine,
} from "react-icons/ri";

import { cn } from "@/lib/utils";
import {
  buildCron,
  defaultScheduleState,
  describeCron,
  formatCronRun,
  humanizeCron,
  isValidCron,
  nextCronRuns,
  parseCronToState,
  relativeToNow,
  WEEKDAYS,
} from "@/util/cron";

// Дружелюбный конструктор расписания (макет согласован до кода). Контролируемый:
// `value` — cron-строка, `onChange(cron)` — новое значение. Два режима:
// «Простой» (периодичность + детали) и «Строка cron» (ручной ввод, как раньше).
// Ближайшие запуски и перевод — из util/cron (TZ организации).

const pad = (n) => String(n).padStart(2, "0");

const FREQS = [
  { value: "minutes", label: "Свой интервал" },
  { value: "hourly", label: "Ежечасно" },
  { value: "daily", label: "Ежедневно" },
  { value: "weekly", label: "Еженедельно" },
  { value: "monthly", label: "Ежемесячно" },
];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const EXAMPLES = [
  ["0 9 * * 1-5", "По будням в 09:00"],
  ["*/30 * * * *", "Каждые 30 минут"],
  ["0 */4 * * *", "Каждые 4 часа"],
  ["0 8 1 * *", "1-го числа в 08:00"],
  ["0 0 1 */3 *", "Каждые 3 месяца"],
  ["30 18 * * 5", "По пятницам в 18:30"],
];

const INP =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/50";
const LAB = "text-sm text-muted-foreground";

const ScheduleBuilder = ({ value, onChange }) => {
  const initial = parseCronToState(value);
  const [mode, setMode] = useState(
    initial ? "simple" : value ? "cron" : "simple",
  );
  const [state, setState] = useState(initial || defaultScheduleState());
  const [cronText, setCronText] = useState(
    value || buildCron(initial || defaultScheduleState()),
  );
  const [notice, setNotice] = useState(false);
  const [copied, setCopied] = useState(false);

  const currentCron = mode === "cron" ? cronText.trim() : buildCron(state);

  useEffect(() => {
    onChange?.(currentCron);
  }, [mode, state, cronText]);

  const patch = (p) => setState((s) => ({ ...s, ...p }));

  const switchMode = (target) => {
    if (target === mode) return;
    if (target === "cron") {
      setCronText(buildCron(state));
      setNotice(false);
      setMode("cron");
      return;
    }
    // cron → simple: только если строка сводится к простым правилам
    const parsed = parseCronToState(cronText);
    if (parsed) {
      setState(parsed);
      setNotice(false);
      setMode("simple");
    } else {
      setNotice(true);
    }
  };

  const copy = () => {
    try {
      navigator.clipboard?.writeText(currentCron);
    } catch {
      /* clipboard недоступен — не критично */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const setTime = (event) => {
    const [h, m] = event.target.value.split(":");
    patch({ hour: +h, minute: +m });
  };
  const timeValue = `${pad(state.hour)}:${pad(state.minute)}`;

  /* ---------- контекстные контролы ---------- */
  const renderContext = () => {
    if (state.freq === "minutes") {
      const isMin = state.everyUnit === "minutes";
      return (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={LAB}>Повторять каждые</span>
          <input
            type="number"
            min="1"
            value={state.everyN}
            onChange={(e) =>
              patch({ everyN: Math.max(1, +e.target.value || 1) })
            }
            className={cn(INP, "w-16 text-center")}
          />
          <select
            value={state.everyUnit}
            onChange={(e) => patch({ everyUnit: e.target.value })}
            className={INP}
          >
            <option value="minutes">минут</option>
            <option value="hours">часов</option>
          </select>
          <div className="flex gap-1.5">
            {[
              ["5m", "5 мин", { everyUnit: "minutes", everyN: 5 }],
              ["30m", "30 мин", { everyUnit: "minutes", everyN: 30 }],
              ["1h", "1 час", { everyUnit: "hours", everyN: 1 }],
            ].map(([key, label, p]) => (
              <button
                key={key}
                type="button"
                onClick={() => patch(p)}
                className="cursor-pointer rounded-md border border-dashed border-border bg-transparent px-2.5 py-1.5 text-xs font-semibold text-accent-text hover:bg-accent"
              >
                {label}
              </button>
            ))}
          </div>
          {!isMin && null}
        </div>
      );
    }

    if (state.freq === "hourly") {
      return (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={LAB}>Каждый час, в минуту</span>
          <select
            value={state.minute}
            onChange={(e) => patch({ minute: +e.target.value })}
            className={INP}
          >
            {[0, 5, 10, 15, 20, 30, 45].map((v) => (
              <option key={v} value={v}>
                :{pad(v)}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (state.freq === "daily") {
      return (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={LAB}>Каждый день, время</span>
            <input
              type="time"
              value={timeValue}
              onChange={setTime}
              className={INP}
            />
          </div>
          <button
            type="button"
            role="checkbox"
            aria-checked={state.weekdaysOnly}
            onClick={() => patch({ weekdaysOnly: !state.weekdaysOnly })}
            className="inline-flex w-fit cursor-pointer items-center gap-2.5 appearance-none border-0 bg-transparent text-sm text-foreground"
          >
            <span
              className={cn(
                "grid size-[18px] place-items-center rounded-[5px] border",
                state.weekdaysOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-transparent",
              )}
            >
              <RiCheckLine className="size-3" />
            </span>
            Только по будням (Пн–Пт)
          </button>
        </div>
      );
    }

    if (state.freq === "weekly") {
      const toggleDay = (v) =>
        patch({
          days: state.days.includes(v)
            ? state.days.filter((d) => d !== v)
            : [...state.days, v],
        });
      return (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={LAB}>По дням</span>
            <div className="flex flex-wrap gap-1.5">
              {DAY_ORDER.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={state.days.includes(v)}
                  onClick={() => toggleDay(v)}
                  className={cn(
                    "size-9 cursor-pointer rounded-lg border text-sm font-semibold tabular-nums",
                    state.days.includes(v)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {WEEKDAYS[v]}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {[
                ["Будни", [1, 2, 3, 4, 5]],
                ["Выходные", [6, 0]],
              ].map(([label, days]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => patch({ days })}
                  className="cursor-pointer rounded-md border border-dashed border-border bg-transparent px-2.5 py-1.5 text-xs font-semibold text-accent-text hover:bg-accent"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={LAB}>Время</span>
            <input
              type="time"
              value={timeValue}
              onChange={setTime}
              className={INP}
            />
          </div>
        </div>
      );
    }

    // monthly
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={LAB}>Каждый месяц, число</span>
          <select
            value={state.dom}
            onChange={(e) => patch({ dom: +e.target.value })}
            className={INP}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <span className={LAB}>время</span>
          <input
            type="time"
            value={timeValue}
            onChange={setTime}
            className={INP}
          />
        </div>
        <p className="m-0 text-xs text-faint">
          Числа 29–31 планировщик не поддерживает напрямую — в коротких месяцах
          запуск пропускается.
        </p>
      </div>
    );
  };

  /* ---------- предпросмотр ---------- */
  const phrase = humanizeCron(currentCron);
  const valid = isValidCron(currentCron);
  const runs = valid ? nextCronRuns(currentCron, 3) : [];

  const preview = (
    <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 p-4">
        <span className="grid size-10 flex-none place-items-center rounded-xl bg-primary/15 text-accent-text">
          <RiTimeLine className="size-5" />
        </span>
        <div className="min-w-0">
          <div
            className={cn(
              "text-lg font-semibold tracking-tight",
              !valid && "text-destructive",
            )}
          >
            {valid ? describeCron(currentCron) : "Неверный формат cron"}
          </div>
          <div className="text-xs text-faint">
            {phrase
              ? "Понятная запись"
              : valid
                ? "Нестандартное правило — работает, но без короткой фразы"
                : "Ожидается 5 полей"}
          </div>
        </div>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-3"
        style={{ borderTop: "1px dashed var(--border)" }}
      >
        <span className="text-xs font-bold tracking-wider text-faint uppercase">
          cron
        </span>
        <code className="rounded-md border border-border bg-accent px-2.5 py-1 font-mono text-sm whitespace-nowrap text-foreground">
          {currentCron}
        </code>
        <button
          type="button"
          onClick={copy}
          title="Копировать"
          aria-label="Копировать"
          className={cn(
            "grid size-[30px] flex-none cursor-pointer place-items-center rounded-md border border-input bg-transparent hover:bg-accent hover:text-foreground",
            copied ? "text-accent-text" : "text-faint",
          )}
        >
          {copied ? (
            <RiCheckLine className="size-[15px]" />
          ) : (
            <RiFileCopyLine className="size-[15px]" />
          )}
        </button>
      </div>
      <div className="border-t border-border-soft px-4 py-3">
        <div className="mb-2 text-xs font-bold tracking-wider text-faint uppercase">
          Ближайшие запуски
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {runs.length ? (
            runs.map((d, i) => (
              <li
                key={d.getTime()}
                className="flex items-center gap-2.5 text-sm tabular-nums"
              >
                <RiTimeLine className="size-4 text-faint" />
                <span>{formatCronRun(d)}</span>
                {i === 0 && (
                  <span className="text-xs text-faint">{relativeToNow(d)}</span>
                )}
              </li>
            ))
          ) : (
            <li className="text-sm text-faint">
              {valid ? "Не удалось вычислить ближайшие запуски" : "—"}
            </li>
          )}
        </ul>
      </div>
    </div>
  );

  /* ---------- разметка ---------- */
  const modeBtn = (target, icon, label) => (
    <button
      type="button"
      aria-pressed={mode === target}
      onClick={() => switchMode(target)}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 px-3 py-1.5 text-sm font-semibold [&_svg]:size-4",
        mode === target
          ? "bg-accent text-foreground inset-ring inset-ring-border"
          : "bg-transparent text-muted-foreground",
      )}
    >
      {icon} {label}
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2.5">
        <span className={LAB}>Режим</span>
        <div className="inline-flex gap-0.5 rounded-lg border border-border bg-background p-0.5">
          {modeBtn("simple", <RiEqualizer2Line />, "Простой")}
          {modeBtn("cron", <RiCodeSSlashLine />, "Строка cron")}
        </div>
      </div>

      {mode === "simple" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {FREQS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={state.freq === f.value}
                onClick={() => patch({ freq: f.value })}
                className={cn(
                  "cursor-pointer rounded-lg border px-3.5 py-2 text-sm font-semibold",
                  state.freq === f.value
                    ? "border-primary/40 bg-primary/15 text-accent-text"
                    : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {renderContext()}
        </div>
      ) : (
        <div>
          <input
            type="text"
            spellCheck={false}
            value={cronText}
            onChange={(e) => {
              setCronText(e.target.value);
              setNotice(false);
            }}
            aria-label="cron-строка"
            className={cn(
              "w-full rounded-lg border bg-background px-3.5 py-3 text-center font-mono text-base tracking-widest text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
              isValidCron(cronText)
                ? "border-input focus-visible:border-ring"
                : "border-destructive",
            )}
          />
          <div className="mt-2 grid grid-cols-5 gap-1.5 text-center text-xs font-semibold text-faint">
            <span>минута</span>
            <span>час</span>
            <span>день мес.</span>
            <span>месяц</span>
            <span>день нед.</span>
          </div>
          {notice && (
            <div className="mt-3 flex items-center gap-2 text-sm text-warning [&_svg]:size-4">
              <RiErrorWarningLine />
              Эта строка не раскладывается на простые правила — оставьте её в
              режиме «Строка cron».
            </div>
          )}
          <div className="mt-4">
            <div className="mb-2 text-sm text-muted-foreground">
              Примеры — нажмите, чтобы подставить:
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(([expr, label]) => (
                <button
                  key={expr}
                  type="button"
                  onClick={() => {
                    setCronText(expr);
                    setNotice(false);
                  }}
                  className="cursor-pointer rounded-lg border border-input bg-background px-2.5 py-1.5 text-left hover:bg-accent"
                >
                  <code className="block font-mono text-xs text-accent-text">
                    {expr}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {preview}

      <p className="mt-3 flex items-center gap-2 text-xs text-faint [&_svg]:size-4">
        <RiTimeLine />
        Время — по часовому поясу организации. Секунды не используются.
      </p>
    </div>
  );
};

export default ScheduleBuilder;

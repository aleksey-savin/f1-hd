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
  "tw:h-9 tw:rounded-lg tw:border tw:border-input tw:bg-background tw:px-3 tw:text-sm tw:text-foreground tw:outline-none tw:focus-visible:border-ring tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50";
const LAB = "tw:text-sm tw:text-muted-foreground";

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
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
          <span className={LAB}>Повторять каждые</span>
          <input
            type="number"
            min="1"
            value={state.everyN}
            onChange={(e) => patch({ everyN: Math.max(1, +e.target.value || 1) })}
            className={cn(INP, "tw:w-16 tw:text-center")}
          />
          <select
            value={state.everyUnit}
            onChange={(e) => patch({ everyUnit: e.target.value })}
            className={INP}
          >
            <option value="minutes">минут</option>
            <option value="hours">часов</option>
          </select>
          <div className="tw:flex tw:gap-1.5">
            {[
              ["5m", "5 мин", { everyUnit: "minutes", everyN: 5 }],
              ["30m", "30 мин", { everyUnit: "minutes", everyN: 30 }],
              ["1h", "1 час", { everyUnit: "hours", everyN: 1 }],
            ].map(([key, label, p]) => (
              <button
                key={key}
                type="button"
                onClick={() => patch(p)}
                className="tw:cursor-pointer tw:rounded-md tw:border tw:border-dashed tw:border-border tw:bg-transparent tw:px-2.5 tw:py-1.5 tw:text-xs tw:font-semibold tw:text-accent-text tw:hover:bg-accent"
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
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
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
        <div className="tw:flex tw:flex-col tw:gap-3.5">
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
            <span className={LAB}>Каждый день, время</span>
            <input type="time" value={timeValue} onChange={setTime} className={INP} />
          </div>
          <button
            type="button"
            role="checkbox"
            aria-checked={state.weekdaysOnly}
            onClick={() => patch({ weekdaysOnly: !state.weekdaysOnly })}
            className="tw:inline-flex tw:w-fit tw:cursor-pointer tw:items-center tw:gap-2.5 tw:appearance-none tw:border-0 tw:bg-transparent tw:text-sm tw:text-foreground"
          >
            <span
              className={cn(
                "tw:grid tw:size-[18px] tw:place-items-center tw:rounded-[5px] tw:border",
                state.weekdaysOnly
                  ? "tw:border-primary tw:bg-primary tw:text-primary-foreground"
                  : "tw:border-input tw:text-transparent",
              )}
            >
              <RiCheckLine className="tw:size-3" />
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
        <div className="tw:flex tw:flex-col tw:gap-3.5">
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2">
            <span className={LAB}>По дням</span>
            <div className="tw:flex tw:flex-wrap tw:gap-1.5">
              {DAY_ORDER.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={state.days.includes(v)}
                  onClick={() => toggleDay(v)}
                  className={cn(
                    "tw:size-9 tw:cursor-pointer tw:rounded-lg tw:border tw:text-sm tw:font-semibold tw:tabular-nums",
                    state.days.includes(v)
                      ? "tw:border-primary tw:bg-primary tw:text-primary-foreground"
                      : "tw:border-input tw:bg-background tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-foreground",
                  )}
                >
                  {WEEKDAYS[v]}
                </button>
              ))}
            </div>
            <div className="tw:flex tw:gap-1.5">
              {[
                ["Будни", [1, 2, 3, 4, 5]],
                ["Выходные", [6, 0]],
              ].map(([label, days]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => patch({ days })}
                  className="tw:cursor-pointer tw:rounded-md tw:border tw:border-dashed tw:border-border tw:bg-transparent tw:px-2.5 tw:py-1.5 tw:text-xs tw:font-semibold tw:text-accent-text tw:hover:bg-accent"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
            <span className={LAB}>Время</span>
            <input type="time" value={timeValue} onChange={setTime} className={INP} />
          </div>
        </div>
      );
    }

    // monthly
    return (
      <div className="tw:flex tw:flex-col tw:gap-2.5">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
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
          <input type="time" value={timeValue} onChange={setTime} className={INP} />
        </div>
        <p className="tw:m-0 tw:text-xs tw:text-faint">
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
    <div className="tw:mt-5 tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card">
      <div className="tw:flex tw:items-center tw:gap-3 tw:p-4">
        <span className="tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-xl tw:bg-primary/15 tw:text-accent-text">
          <RiTimeLine className="tw:size-5" />
        </span>
        <div className="tw:min-w-0">
          <div
            className={cn(
              "tw:text-lg tw:font-semibold tw:tracking-tight",
              !valid && "tw:text-destructive",
            )}
          >
            {valid ? describeCron(currentCron) : "Неверный формат cron"}
          </div>
          <div className="tw:text-xs tw:text-faint">
            {phrase
              ? "Понятная запись"
              : valid
                ? "Нестандартное правило — работает, но без короткой фразы"
                : "Ожидается 5 полей"}
          </div>
        </div>
      </div>
      <div
        className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-2 tw:px-4 tw:py-3"
        style={{ borderTop: "1px dashed var(--border)" }}
      >
        <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
          cron
        </span>
        <code className="tw:rounded-md tw:border tw:border-border tw:bg-accent tw:px-2.5 tw:py-1 tw:font-mono tw:text-sm tw:whitespace-nowrap tw:text-foreground">
          {currentCron}
        </code>
        <button
          type="button"
          onClick={copy}
          title="Копировать"
          aria-label="Копировать"
          className={cn(
            "tw:grid tw:size-[30px] tw:flex-none tw:cursor-pointer tw:place-items-center tw:rounded-md tw:border tw:border-input tw:bg-transparent tw:hover:bg-accent tw:hover:text-foreground",
            copied ? "tw:text-accent-text" : "tw:text-faint",
          )}
        >
          {copied ? (
            <RiCheckLine className="tw:size-[15px]" />
          ) : (
            <RiFileCopyLine className="tw:size-[15px]" />
          )}
        </button>
      </div>
      <div className="tw:border-t tw:border-border-soft tw:px-4 tw:py-3">
        <div className="tw:mb-2 tw:text-[11px] tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
          Ближайшие запуски
        </div>
        <ul className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-1.5 tw:p-0">
          {runs.length ? (
            runs.map((d, i) => (
              <li
                key={d.getTime()}
                className="tw:flex tw:items-center tw:gap-2.5 tw:text-sm tw:tabular-nums"
              >
                <RiTimeLine className="tw:size-4 tw:text-faint" />
                <span>{formatCronRun(d)}</span>
                {i === 0 && (
                  <span className="tw:text-xs tw:text-faint">
                    {relativeToNow(d)}
                  </span>
                )}
              </li>
            ))
          ) : (
            <li className="tw:text-sm tw:text-faint">
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
        "tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-1.5 tw:rounded-md tw:border-0 tw:px-3 tw:py-1.5 tw:text-sm tw:font-semibold tw:[&_svg]:size-4",
        mode === target
          ? "tw:bg-accent tw:text-foreground tw:inset-ring tw:inset-ring-border"
          : "tw:bg-transparent tw:text-muted-foreground",
      )}
    >
      {icon} {label}
    </button>
  );

  return (
    <div>
      <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2.5">
        <span className={LAB}>Режим</span>
        <div className="tw:inline-flex tw:gap-0.5 tw:rounded-lg tw:border tw:border-border tw:bg-background tw:p-0.5">
          {modeBtn("simple", <RiEqualizer2Line />, "Простой")}
          {modeBtn("cron", <RiCodeSSlashLine />, "Строка cron")}
        </div>
      </div>

      {mode === "simple" ? (
        <div className="tw:flex tw:flex-col tw:gap-4">
          <div className="tw:flex tw:flex-wrap tw:gap-1.5">
            {FREQS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={state.freq === f.value}
                onClick={() => patch({ freq: f.value })}
                className={cn(
                  "tw:cursor-pointer tw:rounded-lg tw:border tw:px-3.5 tw:py-2 tw:text-sm tw:font-semibold",
                  state.freq === f.value
                    ? "tw:border-primary/40 tw:bg-primary/15 tw:text-accent-text"
                    : "tw:border-input tw:bg-background tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-foreground",
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
              "tw:w-full tw:rounded-lg tw:border tw:bg-background tw:px-3.5 tw:py-3 tw:text-center tw:font-mono tw:text-base tw:tracking-widest tw:text-foreground tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
              isValidCron(cronText)
                ? "tw:border-input tw:focus-visible:border-ring"
                : "tw:border-destructive",
            )}
          />
          <div className="tw:mt-2 tw:grid tw:grid-cols-5 tw:gap-1.5 tw:text-center tw:text-[11px] tw:font-semibold tw:text-faint">
            <span>минута</span>
            <span>час</span>
            <span>день мес.</span>
            <span>месяц</span>
            <span>день нед.</span>
          </div>
          {notice && (
            <div className="tw:mt-3 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-warn-text [&_svg]:tw:size-4">
              <RiErrorWarningLine />
              Эта строка не раскладывается на простые правила — оставьте её в
              режиме «Строка cron».
            </div>
          )}
          <div className="tw:mt-4">
            <div className="tw:mb-2 tw:text-sm tw:text-muted-foreground">
              Примеры — нажмите, чтобы подставить:
            </div>
            <div className="tw:flex tw:flex-wrap tw:gap-2">
              {EXAMPLES.map(([expr, label]) => (
                <button
                  key={expr}
                  type="button"
                  onClick={() => {
                    setCronText(expr);
                    setNotice(false);
                  }}
                  className="tw:cursor-pointer tw:rounded-lg tw:border tw:border-input tw:bg-background tw:px-2.5 tw:py-1.5 tw:text-left tw:hover:bg-accent"
                >
                  <code className="tw:block tw:font-mono tw:text-xs tw:text-accent-text">
                    {expr}
                  </code>
                  <span className="tw:text-[11.5px] tw:text-muted-foreground">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {preview}

      <p className="tw:mt-3 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-faint [&_svg]:tw:size-4">
        <RiTimeLine />
        Время — по часовому поясу организации. Секунды не используются.
      </p>
    </div>
  );
};

export default ScheduleBuilder;

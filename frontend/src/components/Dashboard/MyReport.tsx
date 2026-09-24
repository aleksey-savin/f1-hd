import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiEyeLine,
  RiEyeOffLine,
} from "react-icons/ri";

import { useCrumbFrom } from "@/components/app/Crumbs";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow, Panel, SubLabel } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import {
  formatMinutes,
  formatMoney,
  fullName,
  initials,
} from "@/components/Report/work-format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthedUser, useCan } from "@/store/authed-user";
import useInitialPrefsStore from "@/store/prefs";
import useEmployeesSummaryStore from "@/store/reports/employees-summary";
import usePersonalReportStore from "@/store/reports/personal-report";
import type {
  EmployeeRow,
  EmployeesSummaryResponse,
  PersonalReportResponse,
} from "@/types/employeesReport";
import { monthRange } from "@/util/period";
import { plural } from "@/util/plural";

/**
 * Отчёт на главной сотрудника — сводка месяца: своя («Я») или по команде.
 *
 * Пересказывает верх отчётов в их же порядке: сперва часы, потом деньги.
 * «Команда» — это «Сотрудники · Переработки», «Я» — «Мой отчёт». Переключатель
 * есть у того, кому открыты оба отчёта, и по умолчанию стоит на команде; у кого
 * один — карточка про него, без переключателя. Месяц листается стрелками, общий
 * для обоих режимов; ни режим, ни месяц не запоминаются.
 *
 * Команда — список тех, у кого за месяц есть работы, по убыванию часов: пять
 * строк и «Показать всех N» на месте. Сотрудников бывает много, а блок на
 * главной показывает ряд, а не весь набор. Строка ведёт в отчёт сотрудника.
 *
 * Суммы — под спойлером. Главную открывают при людях и на общем экране:
 * - скрыты при каждом заходе на главную;
 * - состояние одно на карточку: любая сумма или «Показать» открывает все — и в
 *   строках команды, и при смене месяца или режима, — повтор прячет;
 * - пока скрыто, суммы нет в разметке: пустой слот постоянной ширины;
 * - ставку переработки карточка не пишет вовсе — это тоже деньги.
 * Деньги команды — только с правом на оклады и ставки (без него сервер их и не
 * присылает); свои деньги видны всегда. Страницы отчётов ничего не прячут.
 *
 * Сравнения с прошлым месяцем нет: посреди месяца текущий всегда «хуже»
 * полного прошлого.
 *
 * Данные — те же ручки, что у отчётов, в режиме `details=0`: без списка работ,
 * разрезов и прохода за прошлый период. Загруженные месяцы кэшируются в
 * карточке; пока грузится новый, прежние цифры стоят приглушёнными.
 */

type Mode = "team" | "me";
type Range = { from: string; to: string };

const ROWS = 5;

const MODES = [
  { value: "team", label: "Команда" },
  { value: "me", label: "Я" },
] as const;

const worksNote = (works: number, tickets: number) =>
  works === 0
    ? "работ нет"
    : `${works} ${plural(works, "работа", "работы", "работ")} · ${tickets} ${plural(tickets, "заявка", "заявки", "заявок")}`;

// Список команды: у кого за месяц есть работы, и сам смотрящий — даже без
// работ, как в отчёте «Сотрудники»
const activeEmployees = (employees: EmployeeRow[], currentUserId?: string) =>
  employees
    .filter((row) => row.worksCount > 0 || row.employee._id === currentUserId)
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

// Сумма под спойлером. Скрытая — слот фиксированной ширины с мерцающей крупой
// (утилита `money-spoiler`), открытая — сама сумма; щелчок по любой переключает.
const Money = ({
  value,
  revealed,
  onToggle,
  slot,
}: {
  value: number;
  revealed: boolean;
  onToggle: () => void;
  /** Размер слота: высота — строка своего кегля, чтобы открытие не двигало ряд. */
  slot: string;
}) =>
  revealed ? (
    <button
      type="button"
      onClick={onToggle}
      title="Скрыть суммы"
      className="-mx-1 cursor-pointer rounded-md px-1 whitespace-nowrap tabular-nums outline-none animate-in duration-200 fade-in hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50"
    >
      {formatMoney(value)}
    </button>
  ) : (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Показать суммы"
      title="Показать суммы"
      className={cn(
        "money-spoiler block cursor-pointer rounded-md outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
        slot,
      )}
    />
  );

const RevealButton = ({
  revealed,
  onToggle,
}: {
  revealed: boolean;
  onToggle: () => void;
}) => (
  <Button
    variant="ghost"
    size="xs"
    className="-me-2"
    onClick={onToggle}
    aria-pressed={revealed}
  >
    {revealed ? <RiEyeOffLine /> : <RiEyeLine />}
    {revealed ? "Скрыть" : "Показать"}
  </Button>
);

const Kpi = ({
  label,
  value,
  footer,
}: {
  label: ReactNode;
  value: ReactNode;
  footer?: ReactNode;
}) => (
  <>
    <div className="text-sm font-medium text-muted-foreground">{label}</div>
    <div className="mt-2 text-3xl leading-none font-bold tracking-tight tabular-nums">
      {value}
    </div>
    {footer != null && (
      <div className="mt-1.5 text-xs text-faint tabular-nums">{footer}</div>
    )}
  </>
);

const KpiPair = ({ left, right }: { left: ReactNode; right: ReactNode }) => (
  <div className="grid grid-cols-2">
    <div className="min-w-0 pr-5">{left}</div>
    <div className="min-w-0 border-l border-border-soft pl-5">{right}</div>
  </div>
);

// Строка расчёта — анатомия строки `Report/PayslipPanel`. На телефоне формула
// уходит под подпись, а сумма остаётся справа на обе строки.
const Row = ({
  label,
  formula,
  amount,
  total = false,
}: {
  label: ReactNode;
  formula: ReactNode;
  amount: ReactNode;
  total?: boolean;
}) => (
  <div
    className={cn(
      "grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 border-t border-border-soft py-2.5 first:border-t-0 sm:grid-cols-[1fr_auto_8rem]",
      total && "mt-1 border-border pt-3 font-semibold",
    )}
  >
    <span>{label}</span>
    <span className="col-start-1 text-xs font-normal text-faint tabular-nums sm:col-start-2 sm:row-start-1">
      {formula}
    </span>
    <span
      className={cn(
        "col-start-2 row-span-2 row-start-1 flex justify-end tabular-nums sm:col-start-3 sm:row-span-1",
        total ? "text-lg" : "font-medium",
      )}
    >
      {amount}
    </span>
  </div>
);

// Полоска скелета в строке своей высоты — чтобы колонка не прыгала по загрузке
const Bar = ({ line, className }: { line: string; className: string }) => (
  <span className={cn("flex items-center", line)}>
    <Skeleton className={className} />
  </span>
);

const KpiSkeleton = () => (
  <KpiPair
    left={
      <>
        <Bar line="h-5" className="h-3.5 w-24" />
        <Bar line="mt-2 h-7.5" className="h-7.5 w-24" />
        <Bar line="mt-1.5 h-4" className="h-3 w-32" />
      </>
    }
    right={
      <>
        <Bar line="h-5" className="h-3.5 w-24" />
        <Bar line="mt-2 h-7.5" className="h-7.5 w-24" />
        <Bar line="mt-1.5 h-4" className="h-3 w-40" />
      </>
    }
  />
);

const PersonalSkeleton = () => (
  <>
    <KpiSkeleton />
    <div className="mt-5 border-t border-border-soft pt-3.5">
      <Bar line="mb-2.5 h-4" className="h-3 w-28" />
      {[false, false, true].map((total, index) => (
        <Row
          key={index}
          total={total}
          label={<Bar line="h-5" className="h-3.5 w-24" />}
          formula={<Bar line="h-4" className="h-3 w-20" />}
          amount={
            <Bar
              line={total ? "h-7" : "h-5"}
              className={total ? "h-4 w-28" : "h-3.5 w-22"}
            />
          }
        />
      ))}
    </div>
  </>
);

const TeamSkeleton = () => (
  <>
    <KpiSkeleton />
    <div className="mt-5 border-t border-border-soft pt-3.5">
      <Bar line="mb-2.5 h-4" className="h-3 w-28" />
      <div className="-mx-4 md:-mx-5">
        {Array.from({ length: ROWS }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-2.5 border-t border-border-soft px-4 py-2.5 md:px-5"
          >
            <Skeleton className="size-9 flex-none rounded-[25%]" />
            <span className="flex-1">
              <Bar line="h-5" className="h-3.5 w-40" />
              <Bar line="h-4" className="h-3 w-28" />
            </span>
            <Bar line="h-5" className="h-3.5 w-12" />
          </div>
        ))}
      </div>
    </div>
  </>
);

const PersonalBody = ({
  report,
  revealed,
  onToggle,
}: {
  report: PersonalReportResponse;
  revealed: boolean;
  onToggle: () => void;
}) => {
  const { totals, payroll } = report;
  const { overtime } = totals;
  const hasMoney = payroll.salary != null || payroll.overtimePay != null;

  return (
    <>
      <KpiPair
        left={
          <Kpi
            label="Отработано"
            value={formatMinutes(totals.totalMinutes)}
            footer={worksNote(totals.worksCount, totals.ticketsFinished)}
          />
        }
        right={
          <Kpi
            label="Переработки"
            value={formatMinutes(overtime.roundedMinutes)}
            footer={
              <>
                {/* На телефоне в пол-ширины обе цифры не встают в строку */}
                <span className="sm:hidden">
                  в выходные {formatMinutes(overtime.weekendMinutes)}
                </span>
                <span className="max-sm:hidden">
                  будни {formatMinutes(overtime.weekdayMinutes)} · выходные{" "}
                  {formatMinutes(overtime.weekendMinutes)}
                </span>
              </>
            }
          />
        }
      />

      <div className="mt-5 border-t border-border-soft pt-3.5">
        <SubLabel
          className={hasMoney ? "mb-0.5" : undefined}
          action={
            hasMoney ? (
              <RevealButton revealed={revealed} onToggle={onToggle} />
            ) : undefined
          }
        >
          Расчёт за месяц
        </SubLabel>
        <div className="flex flex-col">
          <Row
            label="Оклад"
            formula={payroll.isFullMonth ? "полный месяц" : "период не месяц"}
            amount={
              payroll.salary == null ? (
                <span className="font-normal text-faint">не указан</span>
              ) : (
                <Money
                  value={payroll.salary}
                  revealed={revealed}
                  onToggle={onToggle}
                  slot="h-5 w-22"
                />
              )
            }
          />
          <Row
            label="Переработки"
            formula={
              payroll.overtimePay == null
                ? formatMinutes(overtime.roundedMinutes)
                : `${formatMinutes(overtime.roundedMinutes)} по ставке`
            }
            amount={
              payroll.overtimePay == null ? (
                <span className="font-normal text-warning">нет ставки</span>
              ) : (
                <Money
                  value={payroll.overtimePay}
                  revealed={revealed}
                  onToggle={onToggle}
                  slot="h-5 w-22"
                />
              )
            }
          />
          <Row
            total
            label="Итого за месяц"
            formula="оклад + доплата"
            amount={
              // Итог сервер считает только при окладе и ставке сразу; прочерк —
              // не сумма, прятать нечего
              payroll.estimatedTotal == null ? (
                <span className="font-normal text-faint">—</span>
              ) : (
                <Money
                  value={payroll.estimatedTotal}
                  revealed={revealed}
                  onToggle={onToggle}
                  slot="h-7 w-28"
                />
              )
            }
          />
        </div>
      </div>
    </>
  );
};

const EmployeeLine = ({
  row,
  isMe,
  canSeeMoney,
  revealed,
  onToggle,
  linkState,
  onOpen,
}: {
  row: EmployeeRow;
  isMe: boolean;
  canSeeMoney: boolean;
  revealed: boolean;
  onToggle: () => void;
  linkState: ReturnType<typeof useCrumbFrom>;
  onOpen: () => void;
}) => {
  const overtime = row.overtime.roundedMinutes;
  const pay = row.payroll.overtimePay;

  return (
    // Ссылка растянута на строку псевдоэлементом, а спойлер лежит над ней
    // (`relative z-10`): кнопка внутри ссылки — невалидная разметка
    <div
      className={cn(
        "relative flex items-center gap-2.5 border-t border-border-soft px-4 py-2.5 hover:bg-accent md:px-5",
        isMe && "bg-primary/7 hover:bg-primary/12",
      )}
    >
      <span className="grid size-9 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border">
        {initials(row.employee)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <Link
            to={`/finances/employees/${row.employee._id}`}
            state={linkState}
            onClick={onOpen}
            className="truncate font-medium text-inherit no-underline outline-none after:absolute after:inset-0 focus-visible:after:ring-4 focus-visible:after:ring-ring/50"
          >
            {fullName(row.employee)}
          </Link>
          {isMe && (
            <span className="flex-none rounded-full bg-primary px-2 py-px text-xs font-semibold text-white">
              Вы
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-faint tabular-nums">
          {row.worksCount} {plural(row.worksCount, "работа", "работы", "работ")}
          {overtime > 0 ? ` · переработки ${formatMinutes(overtime)}` : ""}
        </span>
      </span>
      <span className="flex flex-none flex-col items-end gap-0.5">
        <span className="font-semibold tabular-nums">
          {formatMinutes(row.totalMinutes)}
        </span>
        {canSeeMoney &&
          (row.payroll.missingRate && overtime > 0 ? (
            <span className="text-xs text-warning">нет ставки</span>
          ) : pay ? (
            <span className="relative z-10 flex text-xs">
              <Money
                value={pay}
                revealed={revealed}
                onToggle={onToggle}
                slot="h-4 w-16"
              />
            </span>
          ) : null)}
      </span>
    </div>
  );
};

const TeamBody = ({
  report,
  rows,
  expanded,
  canSeeMoney,
  currentUserId,
  revealed,
  onToggle,
  linkState,
  onOpen,
}: {
  report: EmployeesSummaryResponse;
  /** Уже отобранные и отсортированные `activeEmployees`. */
  rows: EmployeeRow[];
  expanded: boolean;
  canSeeMoney: boolean;
  currentUserId?: string;
  revealed: boolean;
  onToggle: () => void;
  linkState: ReturnType<typeof useCrumbFrom>;
  onOpen: () => void;
}) => {
  const { totals } = report;
  const withOvertime = rows.filter(
    (row) => row.overtime.roundedMinutes > 0,
  ).length;
  const missingRate = report.employees.filter(
    (row) => row.payroll.missingRate && row.overtime.roundedMinutes > 0,
  ).length;
  const teamPay = canSeeMoney ? totals.overtimePaySum : undefined;
  const shown = expanded ? rows : rows.slice(0, ROWS);

  return (
    <>
      <KpiPair
        left={
          <Kpi
            label="Отработано"
            value={formatMinutes(totals.totalMinutes)}
            footer={worksNote(totals.worksCount, totals.ticketsFinished)}
          />
        }
        right={
          <Kpi
            label="Переработки"
            value={formatMinutes(totals.overtime.roundedMinutes)}
            footer={
              rows.length > 0
                ? `у ${withOvertime} из ${rows.length} ${plural(rows.length, "сотрудника", "сотрудников", "сотрудников")}`
                : undefined
            }
          />
        }
      />

      {teamPay != null && (
        <div className="mt-5 border-t border-border-soft pt-3.5">
          <SubLabel
            className="mb-0.5"
            action={<RevealButton revealed={revealed} onToggle={onToggle} />}
          >
            Доплата за месяц
          </SubLabel>
          <div>
            <Row
              total
              label="К доплате по команде"
              formula={
                missingRate > 0 ? (
                  <span className="text-warning">
                    у {missingRate} нет ставки
                  </span>
                ) : (
                  "по ставкам сотрудников"
                )
              }
              amount={
                <Money
                  value={teamPay}
                  revealed={revealed}
                  onToggle={onToggle}
                  slot="h-7 w-28"
                />
              }
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          "border-t border-border-soft pt-3.5",
          teamPay != null ? "mt-2.5" : "mt-5",
        )}
      >
        <SubLabel count={rows.length}>Сотрудники</SubLabel>
        <div className="-mx-4 md:-mx-5">
          {shown.map((row) => (
            <EmployeeLine
              key={row.employee._id}
              row={row}
              isMe={row.employee._id === currentUserId}
              canSeeMoney={teamPay != null}
              revealed={revealed}
              onToggle={onToggle}
              linkState={linkState}
              onOpen={onOpen}
            />
          ))}
          {rows.length === 0 && (
            <div className="border-t border-border-soft px-5 py-2.5 text-sm text-muted-foreground">
              За месяц работ нет
            </div>
          )}
        </div>
      </div>
    </>
  );
};

const MyReport = () => {
  const can = useCan();
  const authedUser = useAuthedUser();
  const modules = useInitialPrefsStore((state) => state.modules);
  const fromState = useCrumbFrom("Главная");

  // Свой отчёт — право `report.own`, отчёт команды — `report.employees`; одно
  // другого не заменяет (у ручек разные гейты)
  const finances = !!modules?.finances?.isActive;
  const canSeeOwn = finances && !!can({ report: ["own"] });
  const canSeeTeam = finances && !!can({ report: ["employees"] });
  const canSeeTeamMoney = !!can({ user: ["manageFinances"] });

  const [pickedMode, setPickedMode] = useState<Mode>("team");
  const [range, setRange] = useState<Range>(() => monthRange(new Date()));
  const [personal, setPersonal] = useState<
    Record<string, PersonalReportResponse>
  >({});
  const [team, setTeam] = useState<Record<string, EmployeesSummaryResponse>>(
    {},
  );
  // Последний загруженный месяц каждого режима — его и показываем
  // приглушённым, пока грузится выбранный
  const [lastKey, setLastKey] = useState<Partial<Record<Mode, string>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const mode: Mode = !canSeeTeam ? "me" : !canSeeOwn ? "team" : pickedMode;
  const visible = mode === "team" ? canSeeTeam : canSeeOwn;
  const key = `${range.from}:${range.to}`;

  useEffect(() => {
    if (!visible) return;
    if ((mode === "team" ? team : personal)[key]) return;
    let cancelled = false;
    const load = async () => {
      const params = new URLSearchParams({ ...range, details: "0" });
      try {
        if (mode === "team") {
          const data = await api<EmployeesSummaryResponse>(
            `/api/finances/employees-summary?${params}`,
          );
          if (cancelled) return;
          setTeam((cache) => ({ ...cache, [key]: data }));
        } else {
          const data = await api<PersonalReportResponse>(
            `/api/finances/personal-report-summary?${params}`,
          );
          if (cancelled) return;
          setPersonal((cache) => ({ ...cache, [key]: data }));
        }
        setLastKey((last) => ({ ...last, [mode]: key }));
        setFailed(null);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить отчёт на главной:", error);
        setFailed(`${mode}:${key}`);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [visible, mode, key, attempt]);

  if (!canSeeOwn && !canSeeTeam) return null;

  const isFailed = failed === `${mode}:${key}`;
  // Первый же запрос не удался — блока нет, как у остальных блоков главной;
  // сбой при листании — строка с повтором, карточка остаётся
  if (isFailed && !lastKey.team && !lastKey.me) return null;

  const teamData = team[key] ?? (lastKey.team ? team[lastKey.team] : undefined);
  const personalData =
    personal[key] ?? (lastKey.me ? personal[lastKey.me] : undefined);
  // Выбранный месяц ещё грузится, а на экране — прежний: его приглушаем
  const stale =
    !isFailed &&
    (mode === "team" ? !team[key] && teamData : !personal[key] && personalData);
  const teamRows = teamData
    ? activeEmployees(teamData.employees, authedUser?._id)
    : [];

  const toggle = () => setRevealed((value) => !value);

  // «Весь отчёт» и строка сотрудника открывают отчёт на выбранном месяце:
  // период отчётов живёт в их сторах, адрес его не несёт
  const syncPersonalPeriod = () => {
    const store = usePersonalReportStore.getState();
    if (store.from !== range.from || store.to !== range.to) {
      usePersonalReportStore.setState({ ...range, data: null });
    }
  };
  const syncTeamPeriod = () => {
    const store = useEmployeesSummaryStore.getState();
    if (store.from !== range.from || store.to !== range.to) {
      useEmployeesSummaryStore.setState({ ...range, data: null });
    }
  };

  let body: ReactNode;
  if (isFailed) {
    body = (
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        Не удалось загрузить отчёт.
        <Button
          variant="outline"
          size="xs"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Повторить
        </Button>
      </div>
    );
  } else if (mode === "team") {
    body = teamData ? (
      <TeamBody
        report={teamData}
        rows={teamRows}
        expanded={expanded}
        canSeeMoney={canSeeTeamMoney}
        currentUserId={authedUser?._id}
        revealed={revealed}
        onToggle={toggle}
        linkState={fromState}
        onOpen={syncPersonalPeriod}
      />
    ) : (
      <TeamSkeleton />
    );
  } else {
    body = personalData ? (
      <PersonalBody
        report={personalData}
        revealed={revealed}
        onToggle={toggle}
      />
    ) : (
      <PersonalSkeleton />
    );
  }

  // Строки команды доходят до подвала сами; остальным телам нужен воздух
  const flushFooter = mode === "team" && !isFailed;

  const controls = (compact: boolean) => (
    <>
      {canSeeTeam && canSeeOwn && (
        <Segmented
          fit
          compact={compact}
          ariaLabel="Чей отчёт"
          options={MODES}
          value={mode}
          onChange={(value) => setPickedMode(value === "me" ? "me" : "team")}
          // Вровень со степпером (h-9): у сегмента свой вертикальный отступ
          className={compact ? "[&>button]:py-1.75" : "[&>button]:py-1.25"}
        />
      )}
      <MonthStepper
        from={range.from}
        to={range.to}
        onChange={setRange}
        // Телефон: степпер во всю ширину своей строкой (см. обёртку ниже)
        className={compact ? "w-full" : undefined}
      />
    </>
  );

  return (
    <section>
      <Eyebrow
        action={
          <span className="flex items-center gap-2 max-md:hidden">
            {controls(false)}
          </span>
        }
      >
        {canSeeTeam && canSeeOwn
          ? "Отчёт"
          : canSeeTeam
            ? "Сотрудники"
            : "Мой отчёт"}
      </Eyebrow>
      {/* Телефон: сегмент и месяц — двумя строками во всю ширину. В один ряд
          они не обязаны помещаться: при крупном шрифте такой ряд раздвигал
          колонку главной за экран (макет «Главная на телефоне — аккуратно») */}
      <div className="mb-2.5 flex flex-col gap-2 md:hidden">
        {controls(true)}
      </div>

      <Panel>
        <div className={cn("transition-opacity", stale && "opacity-60")}>
          {body}
        </div>
        <div
          className={cn(
            "-mx-4 -mb-4 flex items-center gap-3 border-t border-border-soft px-4 py-2.5 text-sm md:-mx-5 md:-mb-5 md:px-5",
            !flushFooter && "mt-5",
          )}
        >
          {mode === "team" && !isFailed && teamRows.length > ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 font-medium text-accent-text outline-none hover:underline focus-visible:underline"
            >
              {expanded ? "Свернуть" : `Показать всех ${teamRows.length}`}
              {expanded ? (
                <RiArrowUpSLine aria-hidden />
              ) : (
                <RiArrowDownSLine aria-hidden />
              )}
            </button>
          )}
          <Link
            to={
              mode === "team"
                ? "/finances/employees?view=overtime"
                : "/finances/my-report"
            }
            state={fromState}
            onClick={mode === "team" ? syncTeamPeriod : syncPersonalPeriod}
            className="ms-auto font-medium text-accent-text no-underline"
          >
            Весь отчёт →
          </Link>
        </div>
      </Panel>
    </section>
  );
};

export default MyReport;

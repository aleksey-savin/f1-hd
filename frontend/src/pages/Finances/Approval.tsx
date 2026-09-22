import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { RiAlertLine } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import CategoryFixDialog from "../../components/Report/CategoryFixDialog";
import EmptyReport from "../../components/Report/EmptyReport";
import PipelineRail, {
  STAGES,
  plural,
} from "../../components/Report/PipelineRail";
import PageShell from "@/components/app/PageShell";
import {
  formatMinutes,
  formatMoney,
} from "../../components/Report/work-format";
import { useCan } from "@/store/authed-user";
import useLiveTopic from "@/hooks/use-live-topic";
import useApprovalStore from "../../store/reports/approval";
import type { PreviewRow, ReportRow } from "../../types/approval";
import { formatMonthLabel, formatShortDate } from "../../util/format-date";

/**
 * «Согласование работ» — конвейер.
 *
 * Прежний экран показывал четыре таблицы подряд и ни одна не отвечала на
 * вопрос, ради которого сюда заходят: где застряли деньги. Рейл стадий
 * отвечает и заодно фильтрует список под собой.
 *
 * Периода у конвейера по умолчанию нет: это очередь, а не отчёт за месяц, и
 * забытый май обязан оставаться видимым. Степпер сужает уже загруженный набор.
 */

const API = import.meta.env.VITE_API_ADDRESS;

const monthOf = (iso: string) => (iso ? String(iso).slice(0, 7) : "");

// Выравнивание числовых колонок задаётся ОДНОЙ строкой и подставляется и в
// шапку, и в ячейку: пока классы писались по отдельности, они разъезжались —
// заголовок прижимался к одному краю колонки, значение к другому
const NUM = "text-right tabular-nums";

const Approval = () => {
  const store = useApprovalStore();
  const navigate = useNavigate();
  const [range, setRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Работы вне услуг чинятся прямо здесь, в модалке, а не переходом на карточку
  const [fixQueue, setFixQueue] = useState<any[] | null>(null);

  useEffect(() => {
    store.fetch();
  }, []);

  // Конвейер живёт своей жизнью: работы закрываются, клиент подписывает —
  // данные подтягиваются сами по пульсу (docs/live-updates.md), а не кнопкой
  // «Обновить». Не чаще раза в 20 секунд: сводка пересчитывает цены всех работ
  useLiveTopic("approval", () => store.silentRefresh(), {
    minIntervalMs: 20_000,
  });

  const data = store.data;
  const stage = store.stage;

  const inRange = (iso: string) => {
    if (!range.from || !range.to) return true;
    const month = monthOf(iso);
    return month >= monthOf(range.from) && month <= monthOf(range.to);
  };

  const previewRows = useMemo(
    () => (data?.preview || []).filter((row) => inRange(`${row.month}-01`)),
    [data, range],
  );

  const stageReports = useMemo(
    () =>
      (data?.reports || [])
        .filter((row) => row.status === stage)
        .filter((row) => inRange(row.periodFrom)),
    [data, stage, range],
  );

  /** Формирование отчёта из строки подбора. */
  const submit = async (row: PreviewRow) => {
    const key = `${row.month}|${row.company._id}|${row.servicePlan._id}`;
    setBusyKey(key);
    setActionError(null);
    try {
      const response = await fetch(`${API}/api/approval/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: row.company._id,
          servicePlanId: row.servicePlan._id,
          workIds: row.workIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Причина отказа человеческая («Отчёт некому согласовать — …»),
        // показываем её как есть: она называет, что чинить
        throw new Error(payload?.message || "Не удалось сформировать отчёт");
      }
      store.fetch();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusyKey(null);
    }
  };

  const openUnrelated = async (row: PreviewRow) => {
    setActionError(null);
    try {
      const response = await fetch(
        `${API}/api/approval/unrelated/${row.company._id}/${row.month}`,
      );
      if (!response.ok)
        throw new Error("Не удалось загрузить работы вне услуг");
      const payload = await response.json();
      setFixQueue(payload.works || []);
    } catch (error) {
      setActionError((error as Error).message);
    }
  };

  const toolbar = (
    <>
      {/* Из выбранного месяца шагами до «всего периода» не вернуться — даём
          явный выход, и он стоит ПЕРЕД степпером: это возврат к состоянию по
          умолчанию, а не следующий шаг после него */}
      {range.from && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRange({ from: "", to: "" })}
        >
          Весь период
        </Button>
      )}
      <MonthStepper
        from={range.from}
        to={range.to}
        onChange={(next) => setRange({ from: next.from, to: next.to })}
      />
    </>
  );

  const errorBanner = store.error && (
    <AlertMessage
      variant="danger"
      message={
        <span className="flex flex-wrap items-center gap-3">
          {store.error}
          <Button variant="outline" size="xs" onClick={() => store.fetch()}>
            Повторить
          </Button>
        </span>
      }
    />
  );

  if (!data) {
    return (
      <PageShell title="Согласование работ" toolbar={toolbar}>
        {store.error ? (
          errorBanner
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5 xl:gap-4">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} className="h-32 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-xl" />
          </div>
        )}
      </PageShell>
    );
  }

  if (data.scope.kind === "none") {
    return (
      <PageShell title="Согласование работ">
        <EmptyReport
          title="Раздел вам пока недоступен"
          hint="Отчёты по услугам видят те, кто их формирует, и согласующие со стороны клиента. Если раздел нужен по работе, попросите администратора назначить вас согласующим в карточке компании."
        />
      </PageShell>
    );
  }

  // У клиента не конвейер: он не гоняет отчёты по стадиям, у него есть то, что
  // ждёт его подписи, и то, что он уже подписал. Форму меняет скоуп с сервера —
  // ровно как в отчёте «Компании»
  if (data.scope.isClientView) {
    const awaiting = (data.reports || []).filter(
      (row) =>
        row.canDecide || (row.parts || []).some((part) => part.canDecide),
    );
    const awaitingIds = new Set(awaiting.map((row) => row._id));

    return (
      <PageShell title="Согласование работ" toolbar={toolbar}>
        <div className={cn("space-y-1", store.isLoading && "opacity-60")}>
          {errorBanner}
          <ClientSummary
            awaiting={awaiting}
            history={(data.reports || [])
              .filter((row) => !awaitingIds.has(row._id))
              .filter((row) => inRange(row.periodFrom))}
            onOpen={(id) => navigate(`/finances/approval/${id}`)}
          />
        </div>
      </PageShell>
    );
  }

  const stageLabel =
    STAGES.find((item) => item.key === stage)?.label || "Отчёты";

  return (
    <PageShell title="Согласование работ" toolbar={toolbar}>
      <div className={cn("space-y-1", store.isLoading && "opacity-60")}>
        {errorBanner}
        {actionError && <AlertMessage variant="danger" message={actionError} />}

        <PipelineRail
          stages={data.stages}
          active={stage}
          onSelect={(next) => store.setStage(next)}
        />

        {/* Отклонённые — не стадия конвейера, а возврат в нашу работу; строкой
            под рейлом, чтобы не потерялись и не притворялись движением вперёд */}
        {(data.stages.declined?.count || 0) > 0 && (
          <button
            type="button"
            onClick={() => store.setStage("declined")}
            className={cn(
              "mt-2 inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-transparent px-1 py-1 text-sm font-semibold outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
              stage === "declined"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            <RiAlertLine className="text-destructive" />
            Отклонено клиентом: {data.stages.declined?.count} на{" "}
            {formatMoney(data.stages.declined?.total || 0)}
          </button>
        )}

        {stage === "preview" ? (
          <PreviewTable
            rows={previewRows}
            busyKey={busyKey}
            onSubmit={submit}
            onOpen={(row) =>
              navigate(
                `/finances/approval/preview/${row.company._id}/${row.servicePlan._id}/${row.month}`,
              )
            }
            onUnrelated={openUnrelated}
          />
        ) : (
          <ReportsTable
            label={stage === "declined" ? "Отклонено клиентом" : stageLabel}
            rows={
              stage === "declined"
                ? (data.reports || [])
                    .filter((row) => row.status === "declined")
                    .filter((row) => inRange(row.periodFrom))
                : stageReports
            }
            onOpen={(id) => navigate(`/finances/approval/${id}`)}
          />
        )}
      </div>

      <CategoryFixDialog
        works={fixQueue || []}
        open={Boolean(fixQueue)}
        onOpenChange={(open) => !open && setFixQueue(null)}
        onFixed={() => store.fetch()}
      />
    </PageShell>
  );
};

/**
 * Подбор: месяц → компания → её услуги, как на прежнем экране.
 *
 * Плоский список тут не годится: за месяц у компании обычно несколько услуг, и
 * без группировки одна и та же компания повторяется строка за строкой, а
 * «Итого» по месяцу собрать глазами невозможно.
 */
const PreviewTable = ({
  rows,
  busyKey,
  onSubmit,
  onOpen,
  onUnrelated,
}: {
  rows: PreviewRow[];
  busyKey: string | null;
  onSubmit: (row: PreviewRow) => void;
  onOpen: (row: PreviewRow) => void;
  onUnrelated: (row: PreviewRow) => void;
}) => {
  // Конвейер открыт и клиенту (`approval.read`) — он видит свои отчёты, но
  // ведёт согласование сторона исполнителя: собрать отчёт, починить работы вне
  // услуг, отправить на подпись. Отсюда действия подбора — под
  // `approval.manage`, а не под тем же правом, что сама страница.
  const can = useCan();
  const canManageApproval = can({ approval: ["manage"] });

  if (rows.length === 0) {
    return (
      <>
        <Eyebrow>Превью</Eyebrow>
        <EmptyReport
          title="Всё разобрано"
          hint="Ни одной завершённой работы, которая ещё не вошла бы в отчёт. Загляните на другие стадии конвейера."
        />
      </>
    );
  }

  // месяц → компания → услуги
  const byMonth = new Map<string, Map<string, PreviewRow[]>>();
  for (const row of rows) {
    if (!byMonth.has(row.month)) byMonth.set(row.month, new Map());
    const companies = byMonth.get(row.month)!;
    const key = row.company._id;
    if (!companies.has(key)) companies.set(key, []);
    companies.get(key)!.push(row);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <Eyebrow count={rows.length}>Превью</Eyebrow>

      <div className="space-y-5">
        {months.map(([month, companies]) => {
          const monthRows = [...companies.values()].flat();
          const totals = monthRows.reduce(
            (sum, row) => ({
              minutes: sum.minutes + row.workingTimeMinutes,
              price: sum.price + row.price,
              additional: sum.additional + row.additionalPrice,
              total: sum.total + row.total,
            }),
            { minutes: 0, price: 0, additional: 0, total: 0 },
          );

          return (
            <div
              key={month}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="border-b border-border px-4 py-2.5 text-xs font-bold tracking-wider text-muted-foreground uppercase">
                {formatMonthLabel(month)}
              </div>
              <div className="px-2 py-1.5">
                {/* table-fixed: колонки берут ширину из шапки, поэтому шапка и
                    тело не разъезжаются, а длинное название услуги переносится
                    вместо растягивания таблицы */}
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Услуга</TableHead>
                      <TableHead className={cn("w-28 whitespace-normal", NUM)}>
                        Часы
                      </TableHead>
                      <TableHead className={cn("w-32 whitespace-normal", NUM)}>
                        В тарифе
                      </TableHead>
                      <TableHead className={cn("w-32 whitespace-normal", NUM)}>
                        Сверх тарифа
                      </TableHead>
                      <TableHead className={cn("w-32 whitespace-normal", NUM)}>
                        Итого
                      </TableHead>
                      <TableHead className="w-56" />
                    </TableRow>
                  </TableHeader>
                  {[...companies.values()].map((companyRows) => {
                    const company = companyRows[0].company;
                    const blocked = companyRows[0].unrelatedWorksCount > 0;
                    return (
                      <TableBody key={company._id}>
                        <TableRow className="bg-accent hover:bg-accent">
                          <TableCell
                            colSpan={6}
                            className="py-2 font-semibold whitespace-normal"
                          >
                            {company.fullTitle || company.alias}
                            {blocked && canManageApproval && (
                              <Button
                                size="xs"
                                variant="outline"
                                className="ms-3 text-warning"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onUnrelated(companyRows[0]);
                                }}
                              >
                                <RiAlertLine />
                                {companyRows[0].unrelatedWorksCount}{" "}
                                {plural(companyRows[0].unrelatedWorksCount, [
                                  "работа",
                                  "работы",
                                  "работ",
                                ])}{" "}
                                вне услуг
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {companyRows.map((row) => {
                          const key = `${row.month}|${row.company._id}|${row.servicePlan._id}`;
                          return (
                            <TableRow
                              key={key}
                              onClick={() => onOpen(row)}
                              className="cursor-pointer"
                            >
                              <TableCell className="whitespace-normal ps-6">
                                {row.servicePlan.title}
                                {row.approval.required && (
                                  <div className="text-sm text-warning">
                                    согласование с клиентом
                                    {row.approval.bySubdivisions &&
                                      ", по филиалам"}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className={NUM}>
                                {formatMinutes(row.workingTimeMinutes)}
                              </TableCell>
                              <TableCell className={NUM}>
                                {formatMoney(row.price)}
                              </TableCell>
                              <TableCell className={NUM}>
                                {row.additionalPrice
                                  ? formatMoney(row.additionalPrice)
                                  : "—"}
                              </TableCell>
                              <TableCell className={cn(NUM, "font-semibold")}>
                                {formatMoney(row.total)}
                              </TableCell>
                              <TableCell
                                className="text-right whitespace-nowrap"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {canManageApproval && (
                                  <Button
                                    size="sm"
                                    disabled={blocked || busyKey === key}
                                    title={
                                      blocked
                                        ? "В отчёт попали бы работы, не привязанные ни к одной услуге"
                                        : undefined
                                    }
                                    onClick={() => onSubmit(row)}
                                  >
                                    {row.approval.required
                                      ? "Отправить на согласование"
                                      : "Утвердить"}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    );
                  })}
                  <TableFooter>
                    <TableRow className="text-base font-semibold">
                      <TableCell>Итого за месяц</TableCell>
                      <TableCell className={NUM}>
                        {formatMinutes(totals.minutes)}
                      </TableCell>
                      <TableCell className={NUM}>
                        {formatMoney(totals.price)}
                      </TableCell>
                      <TableCell className={NUM}>
                        {formatMoney(totals.additional)}
                      </TableCell>
                      <TableCell className={NUM}>
                        {formatMoney(totals.total)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

/**
 * Клиентская сводка: список дел, а не конвейер.
 *
 * Наверху то, что ждёт подписи — карточками, потому что по каждой принимают
 * решение и строка таблицы для этого слишком тиха. Ниже подписанное — таблицей,
 * потому что там уже ничего не делают, туда только заглядывают.
 *
 * Фильтр периода на «ждут подписи» НЕ распространяется: это список дел, и
 * забытый май обязан остаться видимым, каким бы месяцем ни сузили историю.
 */
const ClientSummary = ({
  awaiting,
  history,
  onOpen,
}: {
  awaiting: ReportRow[];
  history: ReportRow[];
  onOpen: (id: string) => void;
}) => (
  <>
    <Eyebrow count={awaiting.length}>Ждут вашей подписи</Eyebrow>
    {awaiting.length === 0 ? (
      <EmptyReport
        title="Подписывать нечего"
        hint="Все отчёты по вашим услугам согласованы. Новый появится здесь, как только исполнитель его пришлёт."
      />
    ) : (
      <div className="rounded-xl border border-border bg-card px-4">
        {awaiting.map((row) => (
          <div
            key={row._id}
            className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-soft py-3.5 first:border-t-0"
          >
            <div className="min-w-56 flex-1">
              <div className="font-semibold">
                {row.servicePlan?.title} · {row.period}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {row.worksCount}{" "}
                {plural(row.worksCount, ["работа", "работы", "работ"])}
                {row.attempt > 1 && ` · попытка ${row.attempt}`}
                {" · "}
                {(row.parts || []).some((part) => part.canDecide)
                  ? `ваша часть: ${(row.parts || [])
                      .filter((part) => part.canDecide)
                      .map((part) => part.subdivisionName)
                      .join(", ")}`
                  : (row.parts || []).length > 0
                    ? `все части подписаны — за вами итог`
                    : "единственная подпись — ваша"}
              </div>
            </div>
            {/* Итог договора руководителю филиала не показывается — у него
                своя часть и только деньги за нерабочее время */}
            <div className="text-end tabular-nums">
              <div className="text-lg font-semibold">
                {formatMoney(row.total ?? row.additionalPrice ?? 0)}
              </div>
              {row.total == null && (
                <div className="text-xs text-muted-foreground">
                  сверх тарифа
                </div>
              )}
            </div>
            <Deadline at={row.approval?.deadlineAt} />
            <Button size="sm" onClick={() => onOpen(row._id)}>
              Открыть
            </Button>
          </div>
        ))}
      </div>
    )}

    <Eyebrow count={history.length}>Подписанные</Eyebrow>
    {history.length === 0 ? (
      <EmptyReport
        title="Здесь пока пусто"
        hint="Согласованные отчёты остаются в этом списке — по ним всегда видно, кто и когда поставил подпись."
      />
    ) : (
      <div className="overflow-x-auto rounded-xl border border-border bg-card px-2 py-1.5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Период</TableHead>
              <TableHead>Услуга</TableHead>
              <TableHead className={cn("w-36 whitespace-normal", NUM)}>
                Сумма
              </TableHead>
              <TableHead>Состояние</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((row) => (
              <TableRow
                key={row._id}
                onClick={() => onOpen(row._id)}
                className="cursor-pointer"
              >
                <TableCell className="whitespace-nowrap">
                  {row.period}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.servicePlan?.title}
                </TableCell>
                <TableCell className={cn(NUM, "font-semibold")}>
                  {formatMoney(row.total ?? row.additionalPrice ?? 0)}
                </TableCell>
                <TableCell>
                  <ClientStateCell row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )}
  </>
);

/** Срок по договору: не дата сама по себе, а сколько дней осталось. */
const Deadline = ({ at }: { at?: string | null }) => {
  if (!at) return null;
  const days = Math.ceil((new Date(at).getTime() - Date.now()) / 86400000);
  return (
    <div className="text-sm whitespace-nowrap text-muted-foreground">
      до {formatShortDate(at)} ·{" "}
      <b
        className={cn(
          "font-semibold",
          days <= 0
            ? "text-destructive"
            : days <= 2
              ? "text-warning"
              : "text-foreground",
        )}
      >
        {days <= 0
          ? "срок вышел"
          : `${days} ${plural(days, ["день", "дня", "дней"])}`}
      </b>
    </div>
  );
};

/**
 * Состояние в истории клиента. «Согласовано автоматически» названо словами:
 * молчание по договору — тоже решение, и клиент должен видеть, что подпись
 * поставил срок, а не он. Строка без объяснения читалась бы как чужая подпись
 * от его имени.
 */
const ClientStateCell = ({ row }: { row: ReportRow }) => {
  if (row.status === "declined") {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-destructive">
        <span className="size-2 rounded-full bg-destructive ring-4 ring-destructive/20" />
        Отклонён — вернулся исполнителю
      </span>
    );
  }
  if (row.status === "pendingApproval") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-info ring-4 ring-info/20" />
        {row.awaiting?.kind === "subdivisions"
          ? `Ждём подразделения: подписано ${row.awaiting.approved} из ${row.awaiting.total}`
          : `Ждём подписи${row.awaiting?.name ? ` · ${row.awaiting.name}` : ""}`}
      </span>
    );
  }
  if (row.approval?.autoApprovedAt) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-faint ring-4 ring-faint/20" />
        Согласовано автоматически
        <span className="text-faint">
          · {formatShortDate(row.approval.autoApprovedAt)} · срок вышел
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text">
      <span className="size-2 rounded-full bg-primary ring-4 ring-primary/20" />
      Согласовано
    </span>
  );
};

/** Отчёты выбранной стадии. Строка ведёт в карточку. */
const ReportsTable = ({
  label,
  rows,
  onOpen,
}: {
  label: string;
  rows: ReportRow[];
  onOpen: (id: string) => void;
}) => {
  if (rows.length === 0) {
    return (
      <>
        <Eyebrow>{label}</Eyebrow>
        <EmptyReport
          title="На этой стадии пусто"
          hint="Выберите другую стадию конвейера или снимите фильтр периода."
        />
      </>
    );
  }

  // Итог у ограниченного зрителя скрыт сервером; в нашем конвейере такого не
  // бывает, но складывать null молча нельзя
  const total = rows.reduce((sum, row) => sum + (row.total ?? 0), 0);

  return (
    <>
      <Eyebrow count={rows.length}>{label}</Eyebrow>
      <div className="overflow-x-auto rounded-xl border border-border bg-card px-2 py-1.5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Компания и услуга</TableHead>
              <TableHead>Период</TableHead>
              <TableHead>Состояние</TableHead>
              <TableHead className={cn("w-36 whitespace-normal", NUM)}>
                Сумма
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row._id}
                onClick={() => onOpen(row._id)}
                className="cursor-pointer"
              >
                <TableCell className="font-medium">
                  {row.company?.alias}
                  <div className="text-sm font-normal text-muted-foreground">
                    {row.servicePlan?.title}
                    {row.attempt > 1 && ` · попытка ${row.attempt}`}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.period}
                </TableCell>
                <TableCell>
                  <StateCell row={row} />
                </TableCell>
                <TableCell className={cn(NUM, "font-semibold")}>
                  {formatMoney(row.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="text-base font-semibold">
              <TableCell colSpan={3}>Итого</TableCell>
              <TableCell className={NUM}>{formatMoney(total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
};

/**
 * Состояние фразой с точкой, а не заливным бейджем: у него есть автор, дата и
 * срок, и всё это должно быть видно без открытия карточки.
 */
const StateCell = ({ row }: { row: ReportRow }) => {
  if (row.status === "declined") {
    const declined = row.parts?.find((part) => part.status === "declined");
    return (
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-destructive">
        <span className="size-2 rounded-full bg-destructive ring-4 ring-destructive/20" />
        Отклонён
        {declined?.decidedBy && (
          <span className="font-normal text-muted-foreground">
            · {declined.decidedBy.lastName} {declined.decidedBy.firstName}
          </span>
        )}
      </span>
    );
  }

  if (row.status === "pendingApproval") {
    const deadline = row.approval?.deadlineAt;
    return (
      <span className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-info">
          <span className="size-2 rounded-full bg-info ring-4 ring-info/20" />
          {row.awaiting?.kind === "subdivisions"
            ? `Филиалы: подписано ${row.awaiting.approved} из ${row.awaiting.total}`
            : row.awaiting?.name || "Ждём подписи"}
        </span>
        {deadline && (
          <span className="text-xs text-faint tabular-nums">
            автоподпись {formatShortDate(deadline)}
          </span>
        )}
      </span>
    );
  }

  if (row.status === "awaitingPayment") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-warning ring-4 ring-warning/20" />
        Счёт {row.invoice?.number || "выставлен"}
        {row.invoice?.date && ` от ${formatShortDate(row.invoice.date)}`}
      </span>
    );
  }

  if (row.status === "paid") {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text">
        <span className="size-2 rounded-full bg-primary ring-4 ring-primary/20" />
        Оплачен
        {row.invoice?.fullyPaidAt && (
          <span className="font-normal text-muted-foreground">
            · {formatShortDate(row.invoice.fullyPaidAt)}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text">
      <span className="size-2 rounded-full bg-primary ring-4 ring-primary/20" />
      {row.approval?.autoApprovedAt ? "Согласован по сроку" : "Утверждён"}
    </span>
  );
};

export default Approval;

export function loader() {
  document.title = "Согласование работ";
  return null;
}

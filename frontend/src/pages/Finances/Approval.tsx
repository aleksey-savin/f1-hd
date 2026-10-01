import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { RiAlertLine } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import { useCrumbFrom } from "@/components/app/Crumbs";
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
  inMonthRange,
  reportMonthKey,
} from "../../components/Report/period-filter";
import {
  ReportZoneProvider,
  useReportDates,
} from "../../components/Report/report-zone";
import {
  StageMoreMenu,
  useStageActions,
} from "../../components/Report/StageActions";
import {
  subjectOfPreview,
  subjectOfReport,
  type StageActionKind,
} from "../../components/Report/stage-actions";
import {
  formatMinutes,
  formatMoney,
} from "../../components/Report/work-format";
import { useCan } from "@/store/authed-user";
import useLiveTopic from "@/hooks/use-live-topic";
import useApprovalStore from "../../store/reports/approval";
import type {
  PipelineStageKey,
  PreviewRow,
  ReportRow,
  ReportStatus,
} from "../../types/approval";
import { formatMonthLabel } from "../../util/format-date";

/**
 * «Согласование работ» — конвейер.
 *
 * Прежний экран показывал четыре таблицы подряд и ни одна не отвечала на
 * вопрос, ради которого сюда заходят: где застряли деньги. Рейл стадий
 * отвечает и заодно фильтрует список под собой.
 *
 * Периода у конвейера по умолчанию нет: это очередь, а не отчёт за месяц, и
 * забытый май обязан оставаться видимым. Степпер сужает уже загруженный набор.
 *
 * Стадия и период живут в АДРЕСЕ (`?stage=…&from=…&to=…`), а не в состоянии
 * страницы: человек проваливается в отчёт и возвращается — крошкой, кнопкой
 * «назад» или после перезагрузки — туда же, откуда ушёл. Крошка карточки
 * получает этот адрес через `useCrumbFrom`.
 *
 * Любой ход, который двигает отчёт, идёт через диалог подтверждения
 * (`Report/StageActions`): из строки списка отчёта целиком не видно, и клик
 * мимо не должен отправлять клиенту письмо или менять стадию.
 */

const API = import.meta.env.VITE_API_ADDRESS;

// Выравнивание числовых колонок задаётся ОДНОЙ строкой и подставляется и в
// шапку, и в ячейку: пока классы писались по отдельности, они разъезжались —
// заголовок прижимался к одному краю колонки, значение к другому
const NUM = "text-right tabular-nums";

type StageFilter = PipelineStageKey | "declined";

const STAGE_FILTERS: string[] = [...STAGES.map((item) => item.key), "declined"];

/**
 * Быстрое действие строки — главный ход стадии. «Напомнить» не залито: решение
 * на этой стадии за клиентом, наш ход только подтолкнуть.
 */
const QUICK_ACTION: Partial<
  Record<
    ReportStatus,
    { kind: StageActionKind; label: string; filled: boolean }
  >
> = {
  pendingApproval: { kind: "remind", label: "Напомнить", filled: false },
  approved: { kind: "invoice", label: "Выставить счёт", filled: true },
  awaitingPayment: {
    kind: "payment",
    label: "Подтвердить оплату",
    filled: true,
  },
};

const Approval = () => {
  const store = useApprovalStore();
  const navigate = useNavigate();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const crumb = useCrumbFrom("Согласование работ");

  const stageParam = params.get("stage") || "";
  const stage: StageFilter = STAGE_FILTERS.includes(stageParam)
    ? (stageParam as StageFilter)
    : "preview";
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const range = useMemo(() => ({ from, to }), [from, to]);

  // Пустое значение убирает параметр: адрес по умолчанию остаётся чистым
  const patchParams = (patch: Record<string, string>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  const setStage = (next: StageFilter) =>
    patchParams({ stage: next === "preview" ? "" : next });
  const setRange = (next: { from: string; to: string }) => patchParams(next);
  // Карточка получает адрес возврата — со стадией и периодом
  const openCard = (path: string) => navigate(path, { state: crumb });

  const [actionError, setActionError] = useState<string | null>(null);
  // Работы вне услуг чинятся прямо здесь, в модалке, а не переходом на карточку
  const [fixQueue, setFixQueue] = useState<any[] | null>(null);

  useEffect(() => {
    store.fetch();
  }, []);

  const data = store.data;

  const stageActions = useStageActions({
    zone: data?.zone,
    onDone: () => store.fetch(),
  });

  // Конвейер живёт своей жизнью: работы закрываются, клиент подписывает —
  // данные подтягиваются сами по пульсу (docs/live-updates.md), а не кнопкой
  // «Обновить». Не чаще раза в 20 секунд: сводка пересчитывает цены всех работ.
  // На время нашего хода — пауза: ответ на него всё равно перечитает конвейер
  useLiveTopic("approval", () => store.silentRefresh(), {
    enabled: !stageActions.busy,
    minIntervalMs: 20_000,
  });

  // Месяц отчёта — ключом с сервера, в поясе организации (Report/period-filter)
  const inPeriod = (row: { month?: string | null; periodFrom?: string }) =>
    inMonthRange(reportMonthKey(row), range);

  const previewRows = useMemo(
    () => (data?.preview || []).filter(inPeriod),
    [data, range],
  );

  const stageReports = useMemo(
    () =>
      (data?.reports || [])
        .filter((row) => row.status === stage)
        .filter(inPeriod),
    [data, stage, range],
  );

  /** Формирование отчёта из строки подбора — через подтверждение. */
  const submit = (row: PreviewRow) =>
    stageActions.open(
      "submit",
      subjectOfPreview(row, {
        period: formatMonthLabel(row.month),
        sendDeadlineAt: data?.sendDeadlineAt,
      }),
    );

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
        <ReportZoneProvider value={data.zone}>
          <div className={cn("space-y-1", store.isLoading && "opacity-60")}>
            {errorBanner}
            <ClientSummary
              awaiting={awaiting}
              history={(data.reports || [])
                .filter((row) => !awaitingIds.has(row._id))
                .filter(inPeriod)}
              onOpen={(id) => openCard(`/finances/approval/${id}`)}
            />
          </div>
        </ReportZoneProvider>
      </PageShell>
    );
  }

  const stageLabel =
    STAGES.find((item) => item.key === stage)?.label || "Отчёты";

  const canManageApproval = can({ approval: ["manage"] });

  return (
    <PageShell title="Согласование работ" toolbar={toolbar}>
      <ReportZoneProvider value={data.zone}>
        <div className={cn("space-y-1", store.isLoading && "opacity-60")}>
          {errorBanner}
          {actionError && (
            <AlertMessage variant="danger" message={actionError} />
          )}

          <PipelineRail
            stages={data.stages}
            active={stage}
            onSelect={(next) => setStage(next)}
          />

          {/* Отклонённые — не стадия конвейера, а возврат в нашу работу; строкой
            под рейлом, чтобы не потерялись и не притворялись движением вперёд */}
          {(data.stages.declined?.count || 0) > 0 && (
            <button
              type="button"
              onClick={() => setStage("declined")}
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
              canManage={canManageApproval}
              onSubmit={submit}
              onOpen={(row) =>
                openCard(
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
                      .filter(inPeriod)
                  : stageReports
              }
              canManage={canManageApproval}
              onOpen={(id) => openCard(`/finances/approval/${id}`)}
              onAction={(kind, row) =>
                stageActions.open(kind, subjectOfReport(row))
              }
            />
          )}
        </div>
      </ReportZoneProvider>

      {stageActions.dialog}

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
  canManage: canManageApproval,
  onSubmit,
  onOpen,
  onUnrelated,
}: {
  rows: PreviewRow[];
  // Конвейер открыт и клиенту (`approval.read`) — он видит свои отчёты, но
  // ведёт согласование сторона исполнителя: собрать отчёт, починить работы вне
  // услуг, отправить на подпись. Отсюда действия — под `approval.manage`, а
  // не под тем же правом, что сама страница.
  canManage: boolean;
  onSubmit: (row: PreviewRow) => void;
  onOpen: (row: PreviewRow) => void;
  onUnrelated: (row: PreviewRow) => void;
}) => {
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
                                    disabled={blocked}
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
  const { shortDate: formatShortDate } = useReportDates();
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
  const { shortDate: formatShortDate } = useReportDates();
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

/**
 * Действия строки: главный ход стадии и меню «⋯» с возвратом назад.
 *
 * Один блок на таблицу и на запись телефона — различается только размер: на
 * узком экране кнопка тянется на всю ширину и держит 44 px под палец.
 */
const RowActions = ({
  row,
  onOpen,
  onAction,
}: {
  row: ReportRow;
  onOpen: (id: string) => void;
  onAction: (kind: StageActionKind, row: ReportRow) => void;
}) => {
  const quick = QUICK_ACTION[row.status];
  return (
    <div className="flex items-center justify-end gap-2">
      {quick && (
        <Button
          size="sm"
          variant={quick.filled ? "default" : "outline"}
          className="max-xl:h-11 max-xl:flex-1"
          onClick={() => onAction(quick.kind, row)}
        >
          {quick.label}
        </Button>
      )}
      <StageMoreMenu
        status={row.status}
        size="sm"
        onOpen={() => onOpen(row._id)}
        onRollback={() => onAction("rollback", row)}
      />
    </div>
  );
};

/** Сверх тарифа: ноль не пишем цифрой — «0 ₽» заставляет искать подвох. */
const extraOf = (value: number | null | undefined) =>
  value ? formatMoney(value) : "—";

/**
 * Отчёты выбранной стадии. Строка ведёт в карточку, а главный ход стадии
 * делается прямо из неё.
 *
 * Сумма разложена на «в тарифе» и «сверх тарифа» теми же словами, что в
 * превью: счёт выставляют по обеим частям, и видеть их надо до карточки.
 */
const ReportsTable = ({
  label,
  rows,
  canManage,
  onOpen,
  onAction,
}: {
  label: string;
  rows: ReportRow[];
  /** Ходы по конвейеру — только держателю `approval.manage`. */
  canManage: boolean;
  onOpen: (id: string) => void;
  onAction: (kind: StageActionKind, row: ReportRow) => void;
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
  const totals = rows.reduce(
    (sum, row) => ({
      price: sum.price + (row.price ?? 0),
      additional: sum.additional + (row.additionalPrice ?? 0),
      total: sum.total + (row.total ?? 0),
    }),
    { price: 0, additional: 0, total: 0 },
  );

  return (
    <>
      <Eyebrow count={rows.length}>{label}</Eyebrow>
      <div className="rounded-xl border border-border bg-card">
        {/* Широкий экран — таблица: стадию сверяют по колонкам сумм */}
        <div className="hidden px-2 py-1.5 xl:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Компания и услуга</TableHead>
                <TableHead className="w-34">Период</TableHead>
                <TableHead className="w-62">Состояние</TableHead>
                <TableHead className={cn("w-34 whitespace-normal", NUM)}>
                  В тарифе
                </TableHead>
                <TableHead className={cn("w-34 whitespace-normal", NUM)}>
                  Сверх тарифа
                </TableHead>
                <TableHead className={cn("w-36 whitespace-normal", NUM)}>
                  Итого
                </TableHead>
                {canManage && <TableHead className="w-54" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row._id}
                  onClick={() => onOpen(row._id)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium whitespace-normal">
                    {row.company?.alias}
                    <div className="text-sm font-normal text-muted-foreground">
                      {row.servicePlan?.title}
                      {row.attempt > 1 && ` · попытка ${row.attempt}`}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.period}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <StateCell row={row} />
                  </TableCell>
                  <TableCell className={NUM}>
                    {formatMoney(row.price)}
                  </TableCell>
                  <TableCell
                    className={cn(NUM, !row.additionalPrice && "text-faint")}
                  >
                    {extraOf(row.additionalPrice)}
                  </TableCell>
                  <TableCell className={cn(NUM, "font-semibold")}>
                    {formatMoney(row.total)}
                  </TableCell>
                  {canManage && (
                    <TableCell
                      className="whitespace-nowrap"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <RowActions
                        row={row}
                        onOpen={onOpen}
                        onAction={onAction}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="text-base font-semibold">
                <TableCell colSpan={3}>Итого</TableCell>
                <TableCell className={NUM}>
                  {formatMoney(totals.price)}
                </TableCell>
                <TableCell className={NUM}>
                  {formatMoney(totals.additional)}
                </TableCell>
                <TableCell className={NUM}>
                  {formatMoney(totals.total)}
                </TableCell>
                {canManage && <TableCell />}
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        {/* Узкий экран — запись вместо строки: семь колонок с кнопкой на
            360 px не живут ни при каких ширинах */}
        <div className="px-4 xl:hidden">
          {rows.map((row) => (
            <div
              key={row._id}
              className="border-t border-border-soft py-3.5 first:border-t-0"
            >
              <div onClick={() => onOpen(row._id)} className="cursor-pointer">
                <div className="flex items-baseline gap-3">
                  <div className="min-w-0 flex-1 font-semibold break-words">
                    {row.company?.alias}
                  </div>
                  <div className="font-semibold whitespace-nowrap tabular-nums">
                    {formatMoney(row.total)}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {row.servicePlan?.title}
                  {row.attempt > 1 && ` · попытка ${row.attempt}`}
                  {row.period && ` · ${row.period}`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  В тарифе {formatMoney(row.price)} · сверх тарифа{" "}
                  {extraOf(row.additionalPrice)}
                </div>
                <div className="mt-1.5">
                  <StateCell row={row} />
                </div>
              </div>
              {canManage && (
                <div className="mt-2.5">
                  <RowActions row={row} onOpen={onOpen} onAction={onAction} />
                </div>
              )}
            </div>
          ))}
          <div className="border-t border-border py-3">
            <div className="flex items-baseline gap-3 text-base font-semibold tabular-nums">
              <span className="flex-1">Итого</span>
              <span>{formatMoney(totals.total)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              В тарифе {formatMoney(totals.price)} · сверх тарифа{" "}
              {extraOf(totals.additional)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

/**
 * Состояние фразой с точкой, а не заливным бейджем: у него есть автор, дата и
 * срок, и всё это должно быть видно без открытия карточки.
 */
const StateCell = ({ row }: { row: ReportRow }) => {
  const { shortDate: formatShortDate } = useReportDates();
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

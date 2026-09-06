import { useState } from "react";
import { RiAlertLine } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import ChipSelect from "@/components/app/ChipSelect";
import { Eyebrow, Panel } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import CompanyLogo from "../Company/CompanyLogo";

import DecisionDialog from "./DecisionDialog";
import ReportLifecycle from "./ReportLifecycle";
import ReportWorksTable from "./ReportWorksTable";
import SignatureRoute from "./SignatureRoute";
import UnrelatedWorks from "./UnrelatedWorks";
import { formatMinutes, formatMoney } from "./work-format";
import { formatShortDate } from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";

/**
 * Карточка отчёта по услуге — один вид на три поверхности: наш конвейер,
 * кабинет клиента и страница по ссылке из письма.
 *
 * Правило «одна информация — один вид»: клиент, открывший письмо, и клиент,
 * зашедший под логином, обязаны увидеть один и тот же документ — иначе подпись
 * ставится под разными бумагами. Различаются только ДЕЙСТВИЯ, и их выбирает
 * состояние отчёта, а не поверхность.
 *
 * Решение клиента живёт здесь же вместе с диалогом: и кнопки в шапке, и части
 * филиалов, и подтверждение — один обработчик. Публичная страница просит
 * `decisionBar`, потому что там страница длинная и без оболочки приложения:
 * кнопка обязана быть под рукой в любой точке прокрутки.
 */

const TARIFF_LABEL: Record<string, string> = {
  hourPackage: "Пакеты часов",
  hourly: "Почасовая оплата",
  fixedPrice: "Фиксированная оплата",
};

type DecisionInput = {
  approve: boolean;
  comment: string;
  subdivisionId?: string;
};

const ReportCard = ({
  report,
  isPreview = false,
  isClientView = false,
  breadcrumb,
  actions,
  busy = false,
  error,
  onDecision,
  onFixed,
  decisionBar = false,
}: {
  report: any;
  isPreview?: boolean;
  /** Клиенту не показываем наш денежный конвейер: счёт и оплата — не его процесс. */
  isClientView?: boolean;
  breadcrumb?: React.ReactNode;
  /** Действия поверхности (экспорт, счёт, оплата) — слева от решения клиента. */
  actions?: React.ReactNode;
  busy?: boolean;
  error?: string | null;
  /** Без него кнопок согласования нет вовсе. */
  onDecision?: (input: DecisionInput) => Promise<void> | void;
  /** Перечитать карточку после правки категории у работ вне услуг. */
  onFixed?: () => void;
  /** Решение — липкой полосой внизу, а не в шапке (страница по ссылке). */
  decisionBar?: boolean;
}) => {
  const [dialog, setDialog] = useState<{
    approve: boolean;
    subdivisionId?: string;
    title: string;
  } | null>(null);
  // Фильтр по подразделению: отчёт крупной компании читают по филиалам, а
  // руководителю филиала чужие работы только мешают
  const [subdivision, setSubdivision] = useState<string | null>(null);

  const terms = report.terms || {};
  const calc = report.calc || {};
  const pendingParts = (report.parts || []).filter(
    (part: any) => part.canDecide,
  );
  const blocked = (report.unrelatedWorks || []).length > 0;
  const canDecide = Boolean(onDecision) && report.canDecide;
  // Руководителю филиала сервер не отдаёт ни итога договора, ни ставок — он
  // подписывает свою часть. Видны только деньги за нерабочее время
  const overtimeOnly = report.money === "overtimeOnly";

  // Подразделения, чья часть уже подписана. Родитель видит и работы своих
  // дочерних — они подписаны и решения от него не ждут, и это должно быть
  // видно в строке, а не только в маршруте подписей
  // Только пока отчёт на согласовании: на закрытом документе подписаны все
  // части, и пометка залила бы таблицу целиком, ничего не сообщая. Это
  // подсказка тому, кто прямо сейчас принимает решение, а не украшение
  const approvedSubdivisions = new Set(
    report.status === "pendingApproval"
      ? (report.parts || [])
          .filter((part: any) => part.status === "approved" && part.subdivision)
          .map((part: any) => String(part.subdivision))
      : [],
  );
  const markApproved = (rows: any[]) =>
    approvedSubdivisions.size === 0
      ? rows
      : rows.map((work) =>
          approvedSubdivisions.has(String(work.subdivision?._id))
            ? { ...work, subdivisionApproved: true }
            : work,
        );

  const subdivisions = report.subdivisions || [];
  const chosen = subdivisions.find((item: any) => item._id === subdivision);
  const bySubdivision = (rows: any[]) =>
    subdivision
      ? rows.filter((work) => work.subdivision?._id === subdivision)
      : rows;
  // Итог под таблицей при фильтре относится к части, а не ко всему отчёту —
  // подпись обязана это называть, иначе цифра читается как отчётная
  const totalLabel = chosen ? `Итого по «${chosen.name}»` : undefined;
  const worktimeWorks = markApproved(bySubdivision(report.worktimeWorks || []));
  const overtimeWorks = markApproved(bySubdivision(report.overtimeWorks || []));

  // Пояснение к пометке — одно на обе раскладки таблиц (почасовая и остальные)
  const approvedNote = worktimeWorks.some(
    (work: any) => work.subdivisionApproved,
  ) ? (
    <>
      Строки с пометкой{" "}
      <b className="font-semibold text-accent-text">согласовано</b> уже
      подписаны руководителями подчинённых подразделений.
    </>
  ) : undefined;

  const decisionButtons = (size?: "sm") => (
    <>
      <Button
        variant="outline"
        size={size}
        disabled={busy}
        onClick={() => setDialog({ approve: false, title: "Отклонить отчёт" })}
      >
        Отклонить
      </Button>
      <Button
        size={size}
        disabled={busy}
        onClick={() => setDialog({ approve: true, title: "Согласовать отчёт" })}
      >
        Согласовать
      </Button>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-7xl">
      {breadcrumb}

      <div className="flex flex-wrap items-start gap-4">
        <CompanyLogo
          company={report.company}
          sizeClass="size-14"
          glyphSize={26}
          className="rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-3xl leading-tight font-semibold tracking-tight">
            {report.company?.alias}
          </h1>
          <div className="mt-1.5 text-sm text-muted-foreground">
            {report.servicePlan?.title} · {report.period}
            {report.attempt > 1 && ` · попытка ${report.attempt}`}
          </div>
          <StatusLine report={report} isPreview={isPreview} />
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          {actions}
          {canDecide && !decisionBar && decisionButtons()}
        </div>
      </div>

      {!isPreview && !isClientView && (
        <div className="mt-4">
          <ReportLifecycle report={report} />
        </div>
      )}

      {error && (
        <div className="mt-4">
          <AlertMessage variant="danger" message={error} />
        </div>
      )}

      {onDecision &&
        pendingParts.map((part: any) => (
          <div key={part._id} className="mt-4">
            <AlertMessage
              variant="info"
              message={
                <span className="flex flex-wrap items-center gap-3">
                  Часть «{part.subdivisionName}» ждёт вашего решения:{" "}
                  {part.worksCount} работ
                  {part.additionalPrice > 0 &&
                    `, сверх тарифа ${formatMoney(part.additionalPrice)}`}
                  {!overtimeOnly &&
                    `, на ${formatMoney(part.price + part.additionalPrice)}`}
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setDialog({
                        approve: false,
                        subdivisionId: part.subdivision,
                        title: `Отклонить часть «${part.subdivisionName}»`,
                      })
                    }
                  >
                    Отклонить
                  </Button>
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      setDialog({
                        approve: true,
                        subdivisionId: part.subdivision,
                        title: `Согласовать часть «${part.subdivisionName}»`,
                      })
                    }
                  >
                    Согласовать
                  </Button>
                </span>
              }
            />
          </div>
        ))}

      {blocked && (
        <>
          <Eyebrow
            count={report.unrelatedWorks.length}
            action={
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warning">
                <RiAlertLine />
                блокируют утверждение отчёта
              </span>
            }
          >
            Работы вне услуг
          </Eyebrow>
          <UnrelatedWorks
            works={report.unrelatedWorks}
            onFixed={() => onFixed?.()}
          />
        </>
      )}

      {report.approval?.required && (
        <>
          <Eyebrow>
            {isPreview ? "Кто будет подписывать" : "Маршрут подписей"}
          </Eyebrow>
          <Panel>
            <SignatureRoute report={report} isClientView={isClientView} />
            {report.approval?.deadlineAt ? (
              <div className="mt-3 border-t border-border-soft pt-3 text-sm text-muted-foreground">
                Ответить нужно до {formatShortDate(report.approval.deadlineAt)}.
                Без ответа отчёт будет согласован автоматически.
              </div>
            ) : report.status === "declined" ? (
              <div className="mt-3 border-t border-border-soft pt-3 text-sm text-muted-foreground">
                <b className="font-semibold text-warning">
                  Автоподпись приостановлена, пока отчёт на правке.
                </b>{" "}
                Отсчёт возобновится с повторной отправки.
              </div>
            ) : null}
          </Panel>
        </>
      )}

      {/* Условия расчёта — предмет финальной подписи: тарифы, пакеты и ставки
          относятся к договору целиком. Руководителю подразделения показывать
          нечего, у него урезаны сами данные */}
      {!overtimeOnly && (
        <>
          <Eyebrow>Условия расчёта</Eyebrow>
          <Panel>
            <div className="grid gap-x-7 md:grid-cols-2">
              <Term
                label="Тип тарификации"
                value={TARIFF_LABEL[terms.type] || "—"}
              />
              <Term
                label="Период тарификации"
                value={
                  terms.tariffingPeriod ? `${terms.tariffingPeriod} минут` : "—"
                }
              />
              {terms.type === "hourPackage" && terms.packageBasis && (
                <Term
                  label="Пакет часов"
                  value={
                    terms.packageBasis.mode === "overflow"
                      ? `${terms.packageBasis.hours} ч + сверх по ${formatMoney(terms.packageBasis.pricePerHour)}/ч`
                      : `${terms.packageBasis.hours} ч · ${formatMoney(
                          terms.packageBasis.hours *
                            terms.packageBasis.pricePerHour,
                        )}`
                  }
                />
              )}
              {terms.type === "fixedPrice" && (
                <Term
                  label="Фиксированная оплата"
                  value={formatMoney(terms.fixedPrice)}
                />
              )}
              {terms.type === "hourly" && (
                <Term
                  label="Стоимость в рабочее время"
                  value={`${formatMoney(terms.pricePerHour)} / час`}
                />
              )}
              <Term
                label="Стоимость в нерабочее время"
                value={
                  terms.pricePerHourNonWorking
                    ? `${formatMoney(terms.pricePerHourNonWorking)} / час`
                    : "—"
                }
              />
              <Term
                label="Работ в отчёте"
                value={String(report.worksCount ?? 0)}
              />
              <Term
                label="Согласование"
                value={
                  terms.approval?.required
                    ? terms.approval?.bySubdivisions
                      ? "С клиентом, по подразделениям"
                      : "С клиентом"
                    : "Не требуется"
                }
              />
            </div>
          </Panel>
        </>
      )}

      {/* Фильтр стоит НАД обеими таблицами и один на них: наборы «в рабочее» и
          «в нерабочее» вычисляемые, и резать их разными подразделениями
          означало бы показывать два разных отчёта рядом */}
      {subdivisions.length > 1 && (
        <div className="mt-7 mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ChipSelect
            placeholder="Подразделение"
            allLabel="Все подразделения"
            value={subdivision}
            options={subdivisions.map((item: any) => ({
              value: item._id,
              label: item.name,
            }))}
            onChange={setSubdivision}
          />
          {chosen && (
            <span className="text-sm text-muted-foreground">
              Итоги под таблицами — по этому подразделению; «Итог» ниже остаётся
              по отчёту целиком.
            </span>
          )}
        </div>
      )}

      {/* У почасовой оплаты деления на рабочее и нерабочее время нет — одна
          таблица без лишнего уточнения в подписи */}
      {terms.type === "hourly" ? (
        <>
          <Eyebrow count={worktimeWorks.length}>Работы</Eyebrow>
          <ReportWorksTable
            works={worktimeWorks}
            totalLabel={totalLabel}
            footnote={approvedNote}
          />
        </>
      ) : (
        <>
          {overtimeWorks.length > 0 && (
            <>
              <Eyebrow
                count={overtimeWorks.length}
                action={
                  <span className="text-sm font-normal text-faint">
                    оплачиваются сверх тарифа
                  </span>
                }
              >
                Выполнены в нерабочее время
              </Eyebrow>
              <ReportWorksTable
                works={overtimeWorks}
                showCost
                totalLabel={totalLabel}
              />
            </>
          )}

          <Eyebrow
            count={worktimeWorks.length}
            action={
              terms.type === "hourPackage" ? (
                <span className="text-sm font-normal text-faint">
                  входят в пакет часов
                </span>
              ) : undefined
            }
          >
            Выполнены в рабочее время
          </Eyebrow>
          <ReportWorksTable
            works={worktimeWorks}
            totalLabel={totalLabel}
            footnote={approvedNote}
          />
        </>
      )}

      <div className="grid gap-x-6 lg:grid-cols-2">
        <div>
          <Eyebrow>Итог</Eyebrow>
          <Panel>
            <CalcRow
              label="В рабочее время"
              hint={`${(report.worktimeWorks || []).length} работ`}
              value={msToHMS((calc.workingTimeMinutes || 0) * 60000)}
            />
            {overtimeOnly && (
              <>
                <CalcRow
                  label="В нерабочее время"
                  hint={`${(report.overtimeWorks || []).length} работ · ${formatMinutes(
                    calc.overtimeMinutes || 0,
                  )}`}
                  value={formatMoney(calc.additionalPrice || 0)}
                />
                <CalcRow
                  label="Сверх тарифа"
                  value={formatMoney(calc.additionalPrice || 0)}
                  total
                />
                {/* Пустое место на месте суммы читалось бы как сбой — говорим,
                    почему её здесь нет и кто её увидит */}
                <div className="mt-2 border-t border-border-soft pt-2 text-xs text-muted-foreground">
                  Итог по отчёту подписывает ответственный со стороны компании —
                  в вашей части показаны только работы вне графика обслуживания,
                  которые оплачиваются дополнительно.
                </div>
              </>
            )}
            {!overtimeOnly && (
              <>
                <CalcRow
                  label={
                    terms.type === "hourPackage" && terms.packageBasis
                      ? `Пакет ${terms.packageBasis.hours} ч`
                      : TARIFF_LABEL[terms.type] || "Оплата"
                  }
                  // Основание берётся из расчёта: при превышении клиент остаётся на
                  // текущем пакете и доплачивает по его ставке, пока это дешевле
                  // фиксированной цены следующего
                  hint={
                    terms.type === "hourPackage" && terms.packageBasis
                      ? terms.packageBasis.mode === "overflow"
                        ? `сверх пакета по ${formatMoney(terms.packageBasis.pricePerHour)}/ч — так дешевле следующего`
                        : `израсходовано ${Math.round(
                            ((calc.workingTimeMinutes || 0) /
                              60 /
                              terms.packageBasis.hours) *
                              100,
                          )} %`
                      : undefined
                  }
                  value={formatMoney(calc.price || 0)}
                />
                {(calc.overtimeMinutes || 0) > 0 && (
                  <CalcRow
                    label="В нерабочее время"
                    hint={`${(report.overtimeWorks || []).length} работ · ${formatMinutes(
                      calc.overtimeMinutes,
                    )}`}
                    value={formatMoney(calc.additionalPrice || 0)}
                  />
                )}
                <CalcRow
                  label="Итого"
                  value={formatMoney(calc.total || 0)}
                  total
                />
              </>
            )}
          </Panel>
        </div>
        <div className={cn(isPreview && "hidden")}>
          <Eyebrow count={report.timeline?.length || 0}>История</Eyebrow>
          <Panel>
            {(report.timeline || []).map((event: any, index: number) => (
              <div
                key={index}
                className="flex gap-3 border-t border-border-soft py-2 text-sm first:border-t-0 first:pt-0"
              >
                <span className="w-20 flex-none text-faint tabular-nums">
                  {formatShortDate(event.at)}
                </span>
                <span
                  className={cn(
                    event.actor === "system" && "text-muted-foreground",
                  )}
                >
                  {eventLabel(event)}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      {/* Липкая полоса решения: страница по ссылке длинная и без навигации —
          возвращаться к шапке за кнопкой человек не станет */}
      {canDecide && decisionBar && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-card px-4 py-3 shadow-[0_-6px_16px_-12px_rgba(0,0,0,0.5)]">
          <p className="my-0 min-w-40 flex-1 text-sm text-muted-foreground">
            {report.approval?.deadlineAt
              ? `${formatShortDate(report.approval.deadlineAt)} отчёт будет согласован автоматически.`
              : ""}
          </p>
          {decisionButtons("sm")}
        </div>
      )}

      <DecisionDialog
        open={Boolean(dialog)}
        approve={dialog?.approve ?? true}
        title={dialog?.title || ""}
        subtitle={[
          report.company?.alias,
          report.servicePlan?.title,
          report.period,
          // У ограниченного зрителя суммы договора нет — и в подтверждении
          // подставлять прочерк вместо неё незачем
          report.total == null ? null : formatMoney(report.total),
        ]
          .filter(Boolean)
          .join(" — ")}
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={async (comment) => {
          await onDecision?.({
            approve: dialog?.approve ?? true,
            comment,
            subdivisionId: dialog?.subdivisionId,
          });
          setDialog(null);
        }}
      />
    </div>
  );
};

/** Состояние фразой с точкой: у него есть автор и дата — бейджа мало. */
const StatusLine = ({
  report,
  isPreview,
}: {
  report: any;
  isPreview: boolean;
}) => {
  if (isPreview) {
    return (
      <span className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-info">
        <span className="size-2 rounded-full bg-info ring-4 ring-info/20" />
        Превью
        <span className="font-normal text-muted-foreground">
          · отчёт ещё не сформирован
        </span>
      </span>
    );
  }

  const MAP: Record<string, { tone: string; label: string }> = {
    pendingApproval: { tone: "info", label: "На утверждении" },
    declined: { tone: "destructive", label: "Отклонён" },
    approved: { tone: "primary", label: "Утверждён" },
    awaitingPayment: { tone: "warning", label: "Ждём оплаты" },
    paid: { tone: "primary", label: "Оплачен" },
    archived: { tone: "faint", label: "В архиве" },
  };
  const state = MAP[report.status] || { tone: "faint", label: report.status };

  const declined = (report.parts || []).find(
    (part: any) => part.status === "declined",
  );
  const who =
    report.status === "declined" && declined?.decidedBy
      ? `${declined.decidedBy.lastName || ""} ${declined.decidedBy.firstName || ""}`.trim()
      : null;

  return (
    <span
      className={cn(
        "mt-2 inline-flex items-center gap-2 text-sm font-semibold",
        state.tone === "info" && "text-info",
        state.tone === "destructive" && "text-destructive",
        state.tone === "primary" && "text-accent-text",
        state.tone === "warning" && "text-warning",
        state.tone === "faint" && "text-faint",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          state.tone === "info" && "bg-info ring-4 ring-info/20",
          state.tone === "destructive" &&
            "bg-destructive ring-4 ring-destructive/20",
          state.tone === "primary" && "bg-primary ring-4 ring-primary/20",
          state.tone === "warning" && "bg-warning ring-4 ring-warning/20",
          state.tone === "faint" && "bg-faint ring-4 ring-faint/20",
        )}
      />
      {report.approval?.autoApprovedAt && report.status === "approved"
        ? "Согласован по сроку"
        : state.label}
      {who && (
        <span className="font-normal text-muted-foreground">· {who}</span>
      )}
      {report.status === "awaitingPayment" && report.invoice?.number && (
        <span className="font-normal text-muted-foreground">
          · счёт № {report.invoice.number}
        </span>
      )}
    </span>
  );
};

const Term = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-4 border-t border-border-soft py-2 text-sm first:border-t-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-semibold tabular-nums">{value}</span>
  </div>
);

const CalcRow = ({
  label,
  hint,
  value,
  total = false,
}: {
  label: string;
  hint?: string;
  value: string;
  total?: boolean;
}) => (
  <div
    className={cn(
      "flex items-baseline gap-3 border-t py-2 text-sm first:border-t-0",
      total ? "border-border font-semibold" : "border-border-soft",
    )}
  >
    <span>{label}</span>
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    <span
      className={cn("ms-auto font-semibold tabular-nums", total && "text-base")}
    >
      {value}
    </span>
  </div>
);

const eventLabel = (event: any) => {
  const who = event.by
    ? `${event.by.lastName || ""} ${event.by.firstName || ""}`.trim()
    : null;
  const where = event.subdivisionName ? ` «${event.subdivisionName}»` : "";
  switch (event.action) {
    case "submitted":
      return `${who || "Исполнитель"} отправил отчёт на согласование`;
    case "resubmitted":
      return `${who || "Исполнитель"} отправил отчёт повторно`;
    case "approved":
      return `${who || "Клиент"} согласовал${where ? ` часть${where}` : " отчёт"}`;
    case "declined":
      return `${who || "Клиент"} отклонил${where ? ` часть${where}` : " отчёт"}${
        event.comment ? `: ${event.comment}` : ""
      }`;
    case "autoApproved":
      return "Отчёт согласован автоматически — истёк срок ответа";
    case "reminded":
      return "Отправлено напоминание о сроке";
    case "invoiced":
      return `${who || "Исполнитель"} выставил счёт${event.comment ? ` ${event.comment}` : ""}`;
    case "paid":
      return `${who || "Исполнитель"} подтвердил оплату`;
    case "archived":
      return `${who || "Исполнитель"} отправил отчёт в архив`;
    default:
      return event.action;
  }
};

export default ReportCard;

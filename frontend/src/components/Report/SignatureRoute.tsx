import { useState } from "react";
import type { ReactNode } from "react";
import { RiArrowDownSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import { plural } from "./PipelineRail";
import type { Actor, ReportPart, ReportRow } from "../../types/approval";
import { formatShortDate } from "../../util/format-date";
import { initials } from "./work-format";

/**
 * Маршрут подписей отчёта — главный элемент карточки.
 *
 * Хребет неизменен: мы → подразделения → финальный согласующий. Но подразделений
 * бывает восемь и больше, и плоская колонка узлов вырастала в башню высотой в
 * карточку, ничего не сообщая: иерархия компании в ней не читалась, «Группа
 * Клиентского Сервиса» стояла вровень с «РА ДВ Регион», хотя входит в неё и
 * подписывается её же руководителем.
 *
 * Поэтому середина — свёрнутый узел. Он отвечает на два вопроса, ради которых
 * сюда смотрят: сдвинулось ли дело (полоса частей) и кто его держит (имена).
 * Разворот даёт поимённый список деревом, и отступ в нём означает не только
 * полномочия (руководитель верхнего узла вправе подписать части своих потомков),
 * но и ОЧЕРЁДНОСТЬ: согласование идёт снизу вверх, вышестоящее подразделение
 * получает письмо и ссылку только когда подписаны все его нижние части. Поэтому
 * у части два разных состояния ожидания — «ждём» и «в очереди».
 *
 * Свёрнуто ВСЕГДА, а не «когда частей много»: порог означал бы, что один и тот
 * же отчёт выглядит по-разному у разных клиентов. Выбор запоминается на сессию.
 *
 * Секция целиком не рендерится, когда согласование не требуется, — пустой
 * виджет с одной галочкой был бы шумом (см. карточку отчёта).
 */

type NodeState = "done" | "wait" | "queued" | "declined" | "stuck";

const OPEN_KEY = "approval-route-open";

const fullName = (actor?: Actor | null) =>
  actor ? `${actor.lastName || ""} ${actor.firstName || ""}`.trim() || "—" : "—";

const shortName = (actor?: Actor | null) =>
  actor
    ? `${actor.lastName || ""} ${(actor.firstName || "").slice(0, 1)}${
        actor.firstName ? "." : ""
      }`.trim()
    : "";

/**
 * Состояние части.
 *
 * «В очереди» отделено от «ждём» намеренно: согласование идёт снизу вверх, и
 * руководителя, чей черёд не наступил, ещё не беспокоили — ни письма, ни ссылки
 * у него нет. Показывать его наравне с теми, от кого сейчас ждут решения,
 * значит валить вину не на того.
 *
 * «Некому подписать» — тоже отдельное: отчёт стоит и будет стоять.
 */
const partState = (part: ReportPart): NodeState => {
  if (part.status === "approved") return "done";
  if (part.status === "declined") return "declined";
  if (part.status === "waiting") return "queued";
  return part.manager ? "wait" : "stuck";
};

/**
 * Части деревом: каждая вкладывается в БЛИЖАЙШЕГО предка, у которого часть тоже
 * есть. Промежуточные узлы без работ не рисуются — «ДВР Групп» корень всей
 * компании, строкой он добавил бы уровень, ничего не сообщающий.
 */
const buildForest = (parts: ReportPart[]) => {
  const present = new Set(parts.map((part) => String(part.subdivision)));
  const childrenOf = new Map<string, ReportPart[]>();
  const roots: ReportPart[] = [];

  for (const part of parts) {
    const parentId = [...(part.ancestors || [])]
      .reverse()
      .find((id) => present.has(String(id)));
    if (parentId) {
      const key = String(parentId);
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(part);
    } else {
      roots.push(part);
    }
  }

  const flat: Array<{ part: ReportPart; depth: number }> = [];
  const walk = (nodes: ReportPart[], depth: number) => {
    for (const part of nodes) {
      flat.push({ part, depth });
      walk(childrenOf.get(String(part.subdivision)) || [], depth + 1);
    }
  };
  walk(roots, 0);
  return flat;
};

/** Узел-конец хребта: мы и финальный согласующий. */
const RouteEnd = ({
  role,
  actor,
  state,
  detail,
}: {
  role: string;
  actor?: Actor | null;
  state: NodeState;
  detail: ReactNode;
}) => (
  <div className="tw:flex tw:max-w-56 tw:flex-none tw:items-start tw:gap-2.5 tw:pt-1.5 tw:max-md:max-w-none">
    <span
      aria-hidden
      className={cn(
        "tw:grid tw:size-8 tw:flex-none tw:place-items-center tw:rounded-full tw:text-xs tw:font-semibold",
        state === "done" && "tw:bg-primary tw:text-primary-foreground",
        state === "declined" && "tw:bg-destructive tw:text-white",
        state !== "done" &&
          state !== "declined" &&
          "tw:bg-accent tw:text-faint tw:inset-ring tw:inset-ring-border",
      )}
    >
      {actor ? initials(actor) : "—"}
    </span>
    <span className="tw:flex tw:min-w-0 tw:flex-col">
      <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
        {role}
      </span>
      <span className="tw:text-sm tw:leading-tight tw:font-semibold">
        {fullName(actor)}
      </span>
      <span
        className={cn(
          "tw:text-xs tw:leading-tight tw:tabular-nums",
          state === "done" ? "tw:text-accent-text" : "tw:text-muted-foreground",
        )}
      >
        {detail}
      </span>
    </span>
  </div>
);

/** Коннектор: линия на десктопе, вертикальный отрезок на узком экране. */
const Wire = () => (
  <span
    aria-hidden
    className="tw:mt-5 tw:h-px tw:min-w-4 tw:flex-1 tw:bg-border tw:max-md:my-1 tw:max-md:ms-4 tw:max-md:h-4 tw:max-md:w-px tw:max-md:min-w-0 tw:max-md:flex-none"
  />
);

const SignatureRoute = ({
  report,
  isClientView = false,
}: {
  report: ReportRow;
  /** Клиенту первый узел — не «Мы», а название компании-исполнителя. */
  isClientView?: boolean;
}) => {
  const [open, setOpen] = useState(
    () => sessionStorage.getItem(OPEN_KEY) === "1",
  );
  const toggle = () => {
    const next = !open;
    setOpen(next);
    sessionStorage.setItem(OPEN_KEY, next ? "1" : "0");
  };

  const all = report.parts || [];
  // Части с собственным подписантом. Остаток «Без подразделения» подписью не
  // является — его закрывает финальный согласующий вместе с итогом
  const parts = all.filter((part) => part.subdivision);
  // Остаток показываем, пока он не закрыт. Своей очереди у него нет вовсе —
  // отдельного подписанта тоже, поэтому проверять `pending` нельзя: он так и
  // стоит в очереди до самой финальной подписи
  const remainder = all.find(
    (part) =>
      !part.subdivision &&
      part.status !== "approved" &&
      part.status !== "declined",
  );
  const hasFork = Boolean(report.approval?.bySubdivisions) && parts.length > 0;

  const submitted = report.approval?.submittedAt;
  const signed = parts.filter((part) => part.status === "approved").length;
  const declined = parts.filter((part) => part.status === "declined");
  const stuck = parts.filter((part) => partState(part) === "stuck");
  const waiting = parts.filter((part) => partState(part) === "wait");
  const queued = parts.filter((part) => partState(part) === "queued");

  const finalDone =
    report.status === "approved" ||
    report.status === "awaitingPayment" ||
    report.status === "paid" ||
    report.status === "archived";
  const finalDetail = finalDone
    ? report.approval?.autoApprovedAt
      ? `по сроку · ${formatShortDate(report.approval.autoApprovedAt)}`
      : "подпись поставлена"
    : hasFork && signed < parts.length
      ? "ждёт части"
      : `${report.status === "declined" ? "ожидает правок" : "ждём согласования"}`;

  // Свёрнутая строка называет то, что мешает двигаться. Отказ и «некому
  // подписать» перебивают обычное ожидание: это не очередь, а остановка
  const summary = declined.length ? (
    <span className="tw:font-semibold tw:text-destructive">
      {shortName(declined[0].decidedBy)} отклонил
      {declined.length > 1
        ? ` ${declined.length} ${plural(declined.length, ["часть", "части", "частей"])}`
        : ` «${declined[0].subdivisionName}»`}
    </span>
  ) : stuck.length ? (
    <span className="tw:font-semibold tw:text-warning">
      подписывать некому: {stuck.map((part) => part.subdivisionName).join(", ")}
    </span>
  ) : waiting.length ? (
    <>
      ждём:{" "}
      {waiting
        .slice(0, 2)
        .map((part) => shortName(part.manager))
        .join(", ")}
      {waiting.length > 2 && ` и ещё ${waiting.length - 2}`}
      {queued.length > 0 && (
        <span className="tw:text-faint">
          {" · "}
          {queued.length} в очереди
        </span>
      )}
    </>
  ) : (
    "все части подписаны"
  );

  return (
    <div className="tw:flex tw:items-start tw:max-md:flex-col tw:max-md:items-stretch">
      <RouteEnd
        // «Мы» понятно только нам. Клиент должен видеть, от кого пришёл
        // документ, — иначе первый узел маршрута ничего ему не сообщает
        role={
          isClientView ? report.contractor?.alias || "Исполнитель" : "Мы"
        }
        actor={report.submittedBy}
        // В подборе отчёт ещё не отправлен — узел не может стоять подписанным:
        // маршрут показывает, КТО будет подписывать, а не притворяется, что
        // дело сделано
        state={submitted ? "done" : "wait"}
        detail={
          submitted
            ? `отправлен · ${formatShortDate(submitted)}`
            : "ещё не отправлен"
        }
      />
      <Wire />

      {hasFork && (
        <div className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-3 tw:border-0 tw:bg-transparent tw:px-3 tw:py-2 tw:text-start tw:text-inherit tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
          >
            <span className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-0.5">
              <span className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
                <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                  Подразделения
                </span>
                <span className="tw:text-sm tw:font-semibold tw:tabular-nums">
                  {signed} из {parts.length} подписали
                </span>
              </span>
              <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
                {summary}
              </span>
            </span>

            {/* По сегменту на часть: восемь филиалов или тридцать — раскладка
                не меняется, а отказ виден мгновенно и свёрнутым */}
            <span
              aria-hidden
              className="tw:flex tw:w-32 tw:flex-none tw:gap-[3px] tw:max-sm:w-20"
            >
              {parts.map((part) => (
                <span
                  key={part._id}
                  className={cn(
                    "tw:h-1.5 tw:flex-1 tw:rounded-xs",
                    partState(part) === "done" && "tw:bg-primary",
                    partState(part) === "declined" && "tw:bg-destructive",
                    partState(part) === "stuck" && "tw:bg-warning",
                    partState(part) === "wait" && "tw:bg-border",
                    // Очередь бледнее текущей волны: это ещё не ожидание
                    partState(part) === "queued" && "tw:bg-border/40",
                  )}
                />
              ))}
            </span>
            <RiArrowDownSLine
              className={cn(
                "tw:flex-none tw:text-faint tw:transition-transform",
                open && "tw:rotate-180",
              )}
            />
          </button>

          {open && (
            <div className="tw:border-t tw:border-border-soft tw:px-1 tw:py-1">
              {buildForest(parts).map(({ part, depth }) => (
                <PartRow key={part._id} part={part} depth={depth} />
              ))}
            </div>
          )}

          {/* Остаток без подразделения: своей подписи у него нет, и молчать об
              этом нельзя — иначе непонятно, куда делись его работы */}
          {open && remainder && (
            <div className="tw:flex tw:flex-wrap tw:gap-x-2 tw:border-t tw:border-border-soft tw:bg-accent tw:px-3.5 tw:py-2 tw:text-xs tw:text-muted-foreground">
              <b className="tw:font-semibold tw:text-foreground">
                Без подразделения
              </b>
              <span>
                {remainder.worksCount}{" "}
                {plural(remainder.worksCount, ["работа", "работы", "работ"])} ·
                подпишет {fullName(report.approval?.finalApprover)} вместе с
                итогом
              </span>
            </div>
          )}
        </div>
      )}
      {hasFork && <Wire />}

      <RouteEnd
        role={hasFork ? "Финал" : "Клиент"}
        actor={report.approval?.finalApprover}
        state={finalDone ? "done" : "wait"}
        detail={finalDetail}
      />
    </div>
  );
};

/** Строка дерева. Отступ = вложенность подразделения, а не украшение. */
const PartRow = ({ part, depth }: { part: ReportPart; depth: number }) => {
  const state = partState(part);
  const when = part.decidedAt ? ` · ${formatShortDate(part.decidedAt)}` : "";
  const meta =
    state === "done"
      ? `подписано${when}`
      : state === "declined"
        ? `отклонено${when}`
        : state === "stuck"
          ? "подписывать некому"
          : state === "queued"
            ? "в очереди"
            : "ждём";
  const who =
    state === "done" || state === "declined"
      ? // Автосогласование по сроку подписи автора не имеет: назвать вместо
        // него чьё-то имя значило бы приписать человеку чужое решение
        fullName(part.decidedBy) === "—"
        ? "по сроку договора"
        : fullName(part.decidedBy)
      : part.manager
        ? fullName(part.manager)
        : "руководитель не назначен";

  return (
    <div
      className="tw:relative tw:grid tw:grid-cols-[1fr_auto] tw:items-baseline tw:gap-x-3 tw:rounded-lg tw:py-1.5 tw:pe-2.5"
      // Глубина через inline-стиль: классов на произвольный уровень не
      // нагенерируешь, а дерево бывает и трёхуровневым
      style={{ paddingInlineStart: `${10 + depth * 19}px` }}
    >
      {depth > 0 && (
        <span
          aria-hidden
          className="tw:absolute tw:inset-y-0 tw:w-px tw:bg-border-soft"
          style={{ insetInlineStart: `${10 + (depth - 1) * 19 + 3}px` }}
        />
      )}
      <span className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">
        <span
          aria-hidden
          className={cn(
            "tw:size-1.5 tw:flex-none tw:-translate-y-px tw:rounded-full tw:ring-3",
            state === "done" && "tw:bg-primary tw:ring-primary/20",
            state === "declined" && "tw:bg-destructive tw:ring-destructive/20",
            state === "stuck" && "tw:bg-warning tw:ring-warning/25",
            state === "wait" && "tw:bg-border tw:ring-accent",
            state === "queued" && "tw:bg-border/50 tw:ring-accent",
          )}
        />
        <span
          className={cn(
            "tw:truncate tw:text-sm",
            state === "done" && "tw:text-muted-foreground",
            state === "queued" && "tw:text-muted-foreground",
            state !== "done" && state !== "queued" && "tw:font-semibold",
          )}
        >
          {part.subdivisionName}
        </span>
      </span>
      <span
        className={cn(
          "tw:text-xs tw:whitespace-nowrap tw:tabular-nums",
          state === "done" && "tw:text-accent-text",
          state === "declined" && "tw:font-semibold tw:text-destructive",
          state === "stuck" && "tw:font-semibold tw:text-warning",
          state === "wait" && "tw:text-muted-foreground",
          state === "queued" && "tw:text-faint",
        )}
      >
        {meta}
      </span>
      <span className="tw:col-start-1 tw:ps-3.5 tw:text-xs tw:text-faint">
        {who}
      </span>
      {part.status === "declined" && part.comment && (
        <q className="tw:col-span-2 tw:ps-3.5 tw:text-xs tw:text-destructive">
          {part.comment}
        </q>
      )}
    </div>
  );
};

export default SignatureRoute;

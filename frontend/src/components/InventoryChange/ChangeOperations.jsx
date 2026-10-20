import { Fragment } from "react";

import EntityLink from "@/components/app/EntityLink";
import { Eyebrow, Panel } from "@/components/app/Panel";
import { cn } from "@/lib/utils";
import { useCan } from "@/store/authed-user";
import {
  createdTo,
  isOpenChange,
  opsCount,
  resultLabel,
  segments,
} from "@/util/inventory-changes";

// Ссылка на ещё не созданное: бэкенд пишет её в текст (changeOps/kit PENDING),
// страница показывает пометку приглушённой, как в макете
const PENDING = "(будет создано выше)";

const RESULT_TEXT = {
  ok: "text-accent-text",
  bad: "text-destructive",
  idle: "text-muted-foreground",
  wait: "text-warning-text",
};

const FINAL = ["done", "partial", "failed"];
const FROM = "Предложение ИИ-агента";
const LINK = "text-accent-text no-underline hover:underline";
const RESULT_LINK = "font-medium text-accent-text no-underline hover:underline";
// Модель и конфигурацию заголовок уже называет: из итога ведёт «открыть модель»
const OPENS_MODEL = ["DeviceModel", "DeviceConfiguration"];

const Pending = ({ text }) =>
  text.split(PENDING).map((piece, index) => (
    <Fragment key={index}>
      {index > 0 && <span className="text-faint">{PENDING}</span>}
      {piece}
    </Fragment>
  ));

// Текст операции: подписи из `links` — ссылками, если страница есть и право на неё есть
const Rich = ({ text, links, can }) =>
  segments(text, links, can).map((segment, index) =>
    segment.to ? (
      <EntityLink key={index} to={segment.to} from={FROM} className={LINK}>
        {segment.text}
      </EntityLink>
    ) : (
      <Pending key={index} text={segment.text} />
    ),
  );

// Созданное операцией в строке итога: устройство — номером, модель и
// конфигурация — «открыть модель» (только ссылкой), остальное — «тип «…»»
const madeItems = (op, kinds, can) => {
  const seen = new Set();
  return op.result.created.flatMap((item) => {
    const to = createdTo(item, can);
    if (OPENS_MODEL.includes(item.model)) {
      if (!to || seen.has(to)) return [];
      seen.add(to);
      return [{ key: `${item.model}:${item.id}`, to, text: "открыть модель" }];
    }
    const kind = kinds.get(`${item.model}:${item.id}`);
    const text =
      item.model === "ClientDevice" || !kind
        ? item.label
        : `${kind} «${item.label}»`;
    return [{ key: `${item.model}:${item.id}`, to, text }];
  });
};

const Result = ({ op, stuck, kinds, can }) => {
  const label = resultLabel(op.result, stuck);
  const error = op.result.error;
  // Причина — основным цветом после подписи итога, как в макете
  const why = error && label.text.endsWith(error) ? error : null;
  const head = why ? label.text.slice(0, -why.length).trimEnd() : label.text;
  const made = op.result.state === "done" ? madeItems(op, kinds, can) : [];

  return (
    <span
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm",
        RESULT_TEXT[label.tone],
      )}
    >
      {/* Первая «·» — в одном куске с подписью, через обычный пробел, как в макете */}
      {made.length ? `${head} ·` : head}
      {why && <span className="wrap-anywhere text-foreground">{why}</span>}
      {made.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && <span aria-hidden>·</span>}
          {item.to ? (
            <EntityLink to={item.to} from={FROM} className={RESULT_LINK}>
              {item.text}
            </EntityLink>
          ) : (
            <span className="wrap-anywhere">{item.text}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
};

// Табличка полей: «было» зачёркнуто, затем «→ стало»; значения — текстом, как в макете
const Fields = ({ fields }) => {
  if (!fields?.length) return null;
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
      {fields.map((field, index) => (
        <Fragment key={index}>
          <dt>{field.label}</dt>
          <dd className="m-0 min-w-0 wrap-anywhere text-foreground">
            {field.before && (
              <>
                <s className="text-faint">{field.before}</s> →{" "}
              </>
            )}
            <Pending text={field.value} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
};

/**
 * Панель «Что изменится»: операции пакета по порядку. У каждой — заголовок со
 * ссылками на существующее, подстроки списком, табличка полей, пометка
 * отложенной проверки, пока предложение открыто, и итог после применения.
 * Предложение до появления `page` приходит без полей и ссылок — тогда это
 * просто заголовок и подстроки.
 */
const ChangeOperations = ({ change }) => {
  const can = useCan();
  const operations = change.operations || [];
  const open = isOpenChange(change);
  const final = FINAL.includes(change.status);
  const kinds = new Map(
    (change.created || []).map((item) => [
      `${item.model}:${item.id}`,
      item.kindLabel,
    ]),
  );

  return (
    <>
      <Eyebrow
        action={
          <span className="text-xs font-semibold tracking-wider text-faint uppercase">
            {opsCount(operations.length)} по порядку
          </span>
        }
      >
        Что изменится
      </Eyebrow>
      <Panel>
        <div className="flex flex-col gap-3">
          <ol className="m-0 flex list-none flex-col p-0">
            {operations.map((op) => (
              <li
                key={op.index}
                className="grid grid-cols-[1.4rem_minmax(0,1fr)] gap-x-2 border-t border-border-soft py-3 first:border-t-0 first:pt-0 last:pb-0"
              >
                <span className="pt-px text-right text-xs text-muted-foreground tabular-nums">
                  {op.index + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-sm wrap-anywhere">
                    <Rich text={op.head} links={op.links} can={can} />
                  </span>
                  {op.subs.length > 0 && (
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-muted-foreground">
                      {op.subs.map((sub, index) => (
                        <li
                          key={index}
                          className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-1"
                        >
                          <span aria-hidden className="text-faint">
                            –
                          </span>
                          <span className="wrap-anywhere">
                            <Rich text={sub} links={op.links} can={can} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Fields fields={op.fields} />
                  {open && op.deferred && (
                    <span className="self-start rounded-md border border-border px-1.5 text-xs leading-4.5 text-muted-foreground">
                      полная проверка при утверждении
                    </span>
                  )}
                  {final && (
                    <Result
                      op={op}
                      stuck={change.stuck}
                      kinds={kinds}
                      can={can}
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
          {open && operations.some((op) => op.deferred) && (
            <span className="text-xs text-faint">
              Пометка «полная проверка при утверждении» — операция зависит от
              предыдущих, HD проверит её в момент применения.
            </span>
          )}
        </div>
      </Panel>
    </>
  );
};

export default ChangeOperations;

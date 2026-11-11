import { Link, useFetcher } from "react-router";
import {
  RiArrowRightLine,
  RiCheckboxBlankCircleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiPauseLine,
  RiPlayLine,
  RiTimeLine,
} from "react-icons/ri";

import { Panel } from "@/components/app/Panel";
import { useCrumbFrom } from "@/components/app/Crumbs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCan } from "@/store/authed-user";
import type { ReviewActionResult, ReviewSummary } from "@/types/userReview";

import useUpgradeClock from "../Mikrotik/use-upgrade-clock.js";
import {
  scanClockActive,
  scanElapsed,
  scanNumber,
  scanPresentation,
} from "./scan-presentation";

export default function ScanProgress({ summary }: { summary: ReviewSummary }) {
  const can = useCan();
  const fetcher = useFetcher<ReviewActionResult>();
  const fromState = useCrumbFrom("Анализ заявок");
  const scan = summary.scan;
  // Только часы отображения: данные процесса обновляет общий пульс страницы.
  const tick = useUpgradeClock(scanClockActive(scan, Date.now()));
  if (!scan)
    return (
      <Panel>
        <p role="status" className="text-sm text-muted-foreground">
          Состояние проверки пока недоступно.
        </p>
      </Panel>
    );
  const now = Math.max(tick, Date.now());
  const view = scanPresentation(scan, summary.analysis.paused, now);
  const elapsed = view.active ? scanElapsed(view.active.startedAt, now) : null;
  const methods = summary.analysisMethods;
  const methodRows = methods
    ? [
        { label: "Без ИИ", count: methods.rules },
        { label: "Предыдущий разбор", count: methods.cache },
        { label: "Разбор ИИ", count: methods.ai },
        { label: "Способ не сохранён", count: methods.unknown },
      ].filter((item) => item.count > 0)
    : [];
  const Icon = view.busy
    ? RiLoader4Line
    : scan.phase === "disabled" || scan.phase === "errors"
      ? RiErrorWarningLine
      : scan.phase === "done"
        ? RiCheckLine
        : scan.hasRun && summary.analysis.paused
          ? RiPauseLine
          : scan.hasRun
            ? RiTimeLine
            : null;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <Icon
                size={22}
                aria-hidden
                className={cn(
                  "shrink-0",
                  view.busy &&
                    "animate-spin text-info-text motion-reduce:animate-none",
                  !view.busy && scan.phase === "done" && "text-primary",
                  !view.busy && scan.phase === "errors" && "text-destructive",
                  !view.busy &&
                    (summary.analysis.paused || scan.phase === "disabled") &&
                    "text-warning-text",
                  !view.busy &&
                    !summary.analysis.paused &&
                    scan.phase === "waiting" &&
                    "text-muted-foreground",
                )}
              />
            )}
            <h2 className="text-lg font-semibold" aria-live="polite">
              {view.title}
            </h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {view.description}
          </p>
          {scan.phase === "disabled" && can({ settings: ["manage"] }) && (
            <Link
              to="/preferences#user-review"
              state={fromState}
              className="mt-2 inline-block text-sm text-accent-text"
            >
              Открыть настройки системы
            </Link>
          )}
          {view.active && (
            <div className="mt-3 text-sm">
              <Link
                to={`/tickets/${view.active.ticket.num}`}
                state={fromState}
                className="font-medium text-foreground no-underline hover:text-accent-text"
              >
                {view.active.ticket.num}
                {view.active.ticket.title && ` · ${view.active.ticket.title}`}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {view.active.stage === "ai"
                  ? "ИИ разбирает изменения доступа и ограничения"
                  : "Проверяем текст и комментарии"}
              </p>
              {elapsed && (
                <p className="mt-1 text-xs text-faint tabular-nums">
                  Заявка в работе: {elapsed}
                </p>
              )}
            </div>
          )}
        </div>
        {summary.canAnalyze && view.action && (
          <fetcher.Form method="post" action="/users/review">
            <Button
              type="submit"
              name="intent"
              value={view.action.intent}
              variant={view.action.intent === "pause" ? "outline" : "default"}
              disabled={fetcher.state !== "idle"}
            >
              {view.action.intent === "pause" ? (
                <RiPauseLine />
              ) : (
                <RiPlayLine />
              )}
              {view.action.label}
            </Button>
          </fetcher.Form>
        )}
      </div>
      {view.progress && (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
            <span>
              Обработано {scanNumber(view.progress.settled)} из{" "}
              {scanNumber(view.progress.total)} заявок
            </span>
            <span className="text-muted-foreground tabular-nums">
              {view.progress.percentLabel}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-accent"
            role="progressbar"
            aria-label="Обработка истории заявок"
            aria-valuemin={0}
            aria-valuenow={view.progress.settled}
            aria-valuemax={view.progress.total}
            aria-valuetext={`Обработано ${view.progress.settled} из ${view.progress.total}; проверено ${view.progress.checked}, не удалось проверить ${view.progress.errors}`}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 motion-reduce:transition-none"
              style={{ width: `${view.progress.percent}%` }}
            />
          </div>
          {view.progress.errors > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Проверено: {scanNumber(view.progress.checked)} · не удалось
              проверить: {scanNumber(view.progress.errors)}.
            </p>
          )}
          {scan.phase === "paused" && scan.remaining > 0 && (
            <p className="mt-2 text-xs text-faint">
              Осталось {scanNumber(scan.remaining)} заявок
            </p>
          )}
        </div>
      )}
      <div className="mt-6 grid gap-4 border-t border-border-soft pt-5 md:grid-cols-3">
        {view.steps.map((step) => (
          <div key={step.label} className="flex gap-2.5">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {step.state === "done" ? (
                <RiCheckLine className="text-primary" size={18} />
              ) : step.state === "running" ? (
                <RiLoader4Line
                  className="animate-spin text-info-text motion-reduce:animate-none"
                  size={18}
                />
              ) : (
                <RiCheckboxBlankCircleLine className="text-faint" size={18} />
              )}
            </span>
            <div>
              <div
                className={cn(
                  "text-sm",
                  step.state === "running" ? "font-semibold" : "font-medium",
                )}
              >
                {step.label}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
      {methodRows.length > 0 && (
        <details className="mt-5 border-t border-border-soft pt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium hover:text-foreground">
            Способы проверки заявок
          </summary>
          <dl className="mt-3 grid max-w-lg grid-cols-2 gap-x-5 gap-y-2">
            {methodRows.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd className="mt-1 font-medium text-foreground tabular-nums">
                  {scanNumber(item.count)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {view.showResults && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border-soft pt-4">
          <Button asChild variant="outline">
            <Link to="/users/review">
              Открыть проверку пользователей <RiArrowRightLine />
            </Link>
          </Button>
        </div>
      )}
      {fetcher.data?.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {fetcher.data.error}
        </p>
      )}
      {fetcher.data?.message && (
        <p role="status" className="mt-3 text-sm text-accent-text">
          {fetcher.data.message}
        </p>
      )}
    </Panel>
  );
}

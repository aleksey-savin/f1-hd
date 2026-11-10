import { Link, useLoaderData, useSearchParams } from "react-router";
import PageShell from "@/components/app/PageShell";
import { Panel } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import Pager from "@/components/app/Pager";
import { formatDate } from "@/util/format-date";
import useLiveRouteRevalidate from "@/hooks/use-live-route-revalidate";
import { AnalysisStatusBadge } from "@/components/UserReview/ReviewStatusBadge";
import ScanProgress from "@/components/UserReview/ScanProgress";
import { useCrumbFrom } from "@/components/app/Crumbs";
import type {
  ReviewAnalysis,
  ReviewPage,
  ReviewSummary,
} from "@/types/userReview";

const methodLabel = {
  rules: "Проверено без ИИ",
  ai: "Разобрано ИИ",
  cache: "Использован предыдущий разбор",
};

export default function UserReviewAnalysis() {
  const { analyses, summary } = useLoaderData() as {
    analyses: ReviewPage<ReviewAnalysis>;
    summary: ReviewSummary;
  };
  const [params, setParams] = useSearchParams();
  const fromState = useCrumbFrom("Анализ заявок");
  useLiveRouteRevalidate("userReview");
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next);
  };
  const state = summary.analysis;
  const total = state.pending + state.processing + state.done + state.error;
  const showAnalyses = summary.scan?.hasRun || total > 0;
  return (
    <PageShell
      title="Анализ заявок"
      breadcrumb={
        <Link
          to="/users/review"
          className="text-sm text-muted-foreground no-underline"
        >
          ‹ Проверка пользователей
        </Link>
      }
      subtitle="Ищем в истории обращений, чьи учётные записи стоит проверить"
    >
      <p className="mb-5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Система ищет упоминания увольнений, возвращения сотрудников и изменения
        доступа. Найденные основания попадают в «Проверку пользователей», где вы
        решаете, что делать с учётной записью.
      </p>
      <ScanProgress summary={summary} />
      {showAnalyses ? (
        <>
          <div className="my-5">
            <Segmented
              compact
              fit
              value={params.get("status") || "all"}
              onChange={(value) => change("status", value)}
              options={[
                { value: "all", label: "Все" },
                {
                  value: "pending",
                  label: "Не проверены",
                  count: state.pending || undefined,
                },
                {
                  value: "done",
                  label: "Проверены",
                  count: state.done || undefined,
                },
              ]}
            />
          </div>
          <Panel className="overflow-hidden p-0">
            {analyses.items.length ? (
              analyses.items.map((item) => {
                const ticket =
                  item.ticket ||
                  (typeof item.ticketId === "object" ? item.ticketId : null);
                return (
                  <div
                    key={item._id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-5 py-4 last:border-0"
                  >
                    <div className="min-w-0 flex-1 break-words">
                      <div className="text-sm font-medium">
                        {ticket ? (
                          <Link
                            to={`/tickets/${ticket.num}`}
                            state={fromState}
                            className="text-foreground no-underline"
                          >
                            №{ticket.num} · {ticket.title}
                          </Link>
                        ) : (
                          "Заявка недоступна"
                        )}
                      </div>
                      <div className="mt-1 text-xs text-faint">
                        {item.checkedAt
                          ? formatDate(item.checkedAt)
                          : "Ещё не проверена"}
                        {item.events?.length
                          ? ` · найдено событий: ${item.events.length}`
                          : item.status === "done"
                            ? " · кадровых изменений и изменений доступа не найдено"
                            : ""}
                      </div>
                      {item.method && item.status === "done" && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {methodLabel[item.method]}
                        </div>
                      )}
                    </div>
                    {(!params.get("status") ||
                      params.get("status") === "all") && (
                      <AnalysisStatusBadge status={item.status} />
                    )}
                  </div>
                );
              })
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                {params.get("status") === "done"
                    ? "Проверенных заявок пока нет."
                    : "Результаты появятся по мере проверки заявок."}
              </p>
            )}
          </Panel>
          <Pager
            page={analyses.page}
            pageSize={analyses.pageSize}
            total={analyses.total}
            loaded={analyses.items.length}
            mobileMode="pages"
            onPage={(page) => change("page", String(page))}
            onLoadMore={() => change("page", String(analyses.page + 1))}
          />
        </>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          После запуска здесь появятся результаты проверки каждой заявки.
        </p>
      )}
    </PageShell>
  );
}

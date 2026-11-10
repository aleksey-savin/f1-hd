import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { api, ApiError } from "@/lib/api";
import { setDocTitle } from "@/hooks/use-doc-title";
import type {
  ReviewAnalysis,
  ReviewPage,
  ReviewProposal,
  ReviewSummary,
  ReviewUser,
} from "@/types/userReview";

export async function reviewLoader({ request }: LoaderFunctionArgs) {
  setDocTitle("Проверка пользователей");
  const url = new URL(request.url);
  const [proposals, summary] = await Promise.all([
    api<ReviewPage<ReviewProposal>>(`/api/user-review/proposals${url.search}`, {
      signal: request.signal,
    }),
    api<ReviewSummary>(`/api/user-review/summary${url.search}`, {
      signal: request.signal,
    }),
  ]);
  return { proposals, summary };
}

export async function analysisLoader({ request }: LoaderFunctionArgs) {
  setDocTitle("Анализ заявок");
  const url = new URL(request.url);
  if (url.searchParams.get("status") === "error") {
    url.searchParams.delete("status");
    url.searchParams.delete("page");
    return redirect(`${url.pathname}${url.search}`);
  }
  const [analyses, summary] = await Promise.all([
    api<ReviewPage<ReviewAnalysis>>(`/api/user-review/analyses${url.search}`, {
      signal: request.signal,
    }),
    api<ReviewSummary>("/api/user-review/summary", { signal: request.signal }),
  ]);
  return { analyses, summary };
}

export const reviewSummaryLoader = ({ request }: LoaderFunctionArgs) =>
  api<ReviewSummary>("/api/user-review/summary", { signal: request.signal });

export const ticketReviewLoader = ({ request, params }: LoaderFunctionArgs) =>
  api<ReviewPage<ReviewProposal>>(
    `/api/user-review/proposals?ticketId=${encodeURIComponent(params.ticketId || "")}&status=all`,
    { signal: request.signal },
  );

export async function reviewAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  try {
    if (intent === "scan")
      return await api<{ message: string }>("/api/user-review/scan", {
        method: "POST",
        body: {},
      });
    if (intent === "pause" || intent === "resume")
      return await api<{ message: string }>("/api/user-review/pause", {
        method: "POST",
        body: { paused: intent === "pause" },
      });
    if (intent === "retry-analysis") {
      const id = String(form.get("analysisId") || "");
      if (!id) return { error: "Не указан результат анализа" };
      return await api<{ message: string }>(
        `/api/user-review/analyses/${encodeURIComponent(id)}/retry`,
        { method: "POST", body: {} },
      );
    }
    const id = String(form.get("proposalId") || "");
    if (
      !id ||
      ![
        "disable",
        "delete",
        "restore",
        "dismiss",
        "defer",
        "match",
        "retry",
      ].includes(intent)
    )
      return { error: "Неизвестное действие" };
    return await api<{ message: string }>(
      `/api/user-review/proposals/${encodeURIComponent(id)}/decision`,
      {
        method: "POST",
        body: {
          intent,
          reason: String(form.get("reason") || ""),
          ...(form.get("userId") ? { userId: String(form.get("userId")) } : {}),
          ...(form.get("deferredUntil")
            ? { deferredUntil: String(form.get("deferredUntil")) }
            : {}),
        },
      },
    );
  } catch (error) {
    return {
      error:
        error instanceof ApiError
          ? error.message
          : "Не удалось выполнить действие",
    };
  }
}

export async function deletedUsersLoader({ request }: LoaderFunctionArgs) {
  setDocTitle("Удалённые пользователи");
  const params = new URL(request.url).searchParams;
  params.set("deleted", "only");
  params.set("activeOnly", "false");
  params.set("service", "any");
  return api<{
    users: ReviewUser[];
    total: number;
    page?: number;
    limit?: number;
  }>(`/api/users?${params}`, { signal: request.signal });
}

export async function restoreUserAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (!id || form.get("intent") !== "restore")
    return { error: "Неизвестное действие" };
  try {
    return await api<{ message: string }>(
      `/api/users/restore/${encodeURIComponent(id)}`,
      { method: "POST", body: {} },
    );
  } catch (error) {
    return {
      error:
        error instanceof ApiError
          ? error.message
          : "Не удалось восстановить пользователя",
    };
  }
}

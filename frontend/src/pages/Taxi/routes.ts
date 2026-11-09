import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type {
  TaxiReportData,
  TaxiReportResult,
  TaxiActionResult,
  TaxiDetail,
  TaxiSyncResult,
} from "@/types/taxi";
import { setDocTitle } from "@/hooks/use-doc-title";
import { taxiSyncFeedback } from "@/components/Preferences/taxi-health";

/** All taxi HTTP calls are made by data-router loaders/actions. */
export async function taxiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS || ""}/api${path}`,
    {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init.headers },
    },
  );
  if (!response.ok) {
    let message = "Не удалось выполнить действие с такси";
    try {
      const body: unknown = await response.json();
      if (
        body &&
        typeof body === "object" &&
        "message" in body &&
        typeof body.message === "string"
      )
        message = body.message;
    } catch {
      /* The HTTP status remains usable when the gateway sends HTML. */
    }
    throw new Response(message, { status: response.status });
  }
  return (await response.json()) as T;
}

export async function settingsAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  try {
    if (intent === "taxi-employee") {
      await taxiRequest(
        `/taxi/employees/${encodeURIComponent(String(form.get("externalId")))}`,
        {
          method: "PUT",
          body: JSON.stringify({ userId: form.get("userId") || null }),
        },
      );
    } else if (intent === "taxi-sync") {
      const result = await taxiRequest<TaxiSyncResult>("/taxi/sync", {
        method: "POST",
        body: "{}",
      });
      return { ...taxiSyncFeedback(result), intent };
    } else if (intent === "taxi-check") {
      await taxiRequest(`/taxi/${intent.slice(5)}`, {
        method: "POST",
        body: "{}",
      });
    } else throw new Response("Неизвестное действие", { status: 400 });
    return {
      ok: true,
      intent,
      message:
        intent === "taxi-check" ? "Доступ проверен" : "Сотрудник сопоставлен",
    };
  } catch (error) {
    return {
      error:
        error instanceof Response
          ? await error.text()
          : "Не удалось выполнить действие",
      intent,
    };
  }
}
export { settingsAction as taxiSettingsAction };

export function taxiQuery(request: Request): string {
  return new URL(request.url).search;
}

export const tripDetailLoader = ({ params }: LoaderFunctionArgs) =>
  taxiRequest<TaxiDetail>(`/taxi/trips/${params.id}`);

export async function reportLoader({
  request,
}: LoaderFunctionArgs): Promise<TaxiReportResult> {
  setDocTitle("Такси");
  try {
    return {
      report: await taxiRequest<TaxiReportData>(
        `/taxi/trips${taxiQuery(request)}`,
        { signal: request.signal },
      ),
    };
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Response && [401, 403].includes(error.status))
    )
      throw error;
    return {
      error:
        error instanceof Response
          ? await error.text()
          : "Не удалось загрузить поездки. Проверьте соединение и повторите.",
    };
  }
}
/** Resource intents are shared by the report, work forms and ticket reminder. */
export async function taxiAction({
  request,
}: ActionFunctionArgs): Promise<TaxiActionResult> {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  try {
    const raw: unknown = JSON.parse(String(form.get("payload") || "{}"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Response("Некорректное действие", { status: 400 });
    const payload = raw as Record<string, unknown>;
    if (intent === "delete") {
      const id = String(form.get("id") || "");
      await taxiRequest(`/taxi/trips/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      return { ok: true, intent, deletedTripId: id };
    }
    if (intent === "allocation-options") {
      const query = new URLSearchParams({
        companyId: String(payload.companyId || ""),
      });
      return {
        intent,
        allocationOptions: await taxiRequest<
          NonNullable<TaxiActionResult["allocationOptions"]>
        >(
          `/taxi/trips/${encodeURIComponent(String(payload.tripId))}/allocation-options?${query}`,
        ),
      };
    }
    if (intent === "candidates")
      return {
        ...(await taxiRequest<{
          trips: TaxiReportData["trips"];
          isActive: boolean;
        }>("/taxi/candidates", {
          method: "POST",
          body: JSON.stringify(payload),
        })),
        intent,
        candidateKey: String(form.get("candidateKey") || ""),
      };
    if (intent === "ticket-candidates")
      return {
        ...(await taxiRequest<{
          trips: TaxiReportData["trips"];
          isActive: boolean;
        }>(
          `/taxi/tickets/${encodeURIComponent(String(payload.ticketId))}/candidates`,
        )),
        intent,
      };
    if (intent === "ticket-trips")
      return {
        ...(await taxiRequest<{ trips: TaxiReportData["trips"] }>(
          `/taxi/tickets/${encodeURIComponent(String(payload.ticketId))}/trips`,
        )),
        intent,
      };
    if (intent === "allocation") {
      const { id, ...allocation } = payload;
      const trip = await taxiRequest<TaxiDetail["trip"]>(
        `/taxi/trips/${encodeURIComponent(String(id))}/allocation`,
        { method: "PATCH", body: JSON.stringify(allocation) },
      );
      return { ok: true, trip, intent };
    }
    throw new Response("Неизвестное действие", { status: 400 });
  } catch (error) {
    return {
      error:
        error instanceof Response
          ? await error.text()
          : "Не удалось выполнить действие",
      intent,
    };
  }
}

export async function tripStatusLoader(args: LoaderFunctionArgs) {
  try {
    return await tripDetailLoader(args);
  } catch (error) {
    return {
      error:
        error instanceof Response
          ? await error.text()
          : "Не удалось обновить поездку",
    };
  }
}

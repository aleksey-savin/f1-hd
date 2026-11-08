import { redirect } from "react-router";
import { api } from "@/lib/api";
export const ROOT = "/devices/proxmox";
export const labels = {
  guests: "ВМ и LXC",
  nodes: "Узлы",
  storages: "Хранилища",
  connections: "Подключения",
  companies: "Компании",
  settings: "Настройки",
};
const endpoint = (kind) => kind;
export const listLoader =
  (kind) =>
  async ({ request }) => {
    const url = new URL(request.url);
    const query = new URLSearchParams(url.search);
    const more = Math.min(30, Math.max(1, Number(query.get("more")) || 1));
    query.delete("more");
    if (query.get("sort")?.startsWith("-")) {
      query.set("sort", query.get("sort").slice(1));
      query.set("order", "desc");
    } else if (query.has("sort")) query.set("order", "asc");
    const responses = await Promise.all(
      Array.from({ length: more }, (_, i) => {
        const q = new URLSearchParams(query);
        if (more > 1) q.set("page", String(i + 1));
        return api(`/api/proxmox/${endpoint(kind)}?${q}`, {
          signal: request.signal,
        });
      }),
    );
    return {
      ...responses.at(-1),
      items: responses.flatMap((r) => r.items || []),
      kind,
      options: await api("/api/proxmox/options", { signal: request.signal }),
    };
  };
export const detailLoader =
  (kind) =>
  async ({ params, request }) => {
    const [data, options] = await Promise.all([
      api(`/api/proxmox/${endpoint(kind)}/${params.id}`, {
        signal: request.signal,
      }),
      api("/api/proxmox/options", { signal: request.signal }),
    ]);
    return { ...data, kind, options };
  };
export async function formLoader({ request, params }) {
  const url = new URL(request.url);
  if (url.searchParams.has("discoverySession")) {
    try {
      return await api(
        `/api/proxmox/discovery/sessions/${encodeURIComponent(url.searchParams.get("discoverySession"))}`,
        { signal: request.signal },
      );
    } catch (error) {
      if (error.status === 401) throw error;
      return {
        error: true,
        message:
          error.status === 404
            ? "Поиск завершён или срок сессии истёк. Запустите поиск снова."
            : error.message,
        sessionId: url.searchParams.get("discoverySession"),
      };
    }
  }
  const options = await api("/api/proxmox/options", { signal: request.signal });
  const data = params.id
    ? await api(`/api/proxmox/connections/${params.id}`, {
        signal: request.signal,
      })
    : null;
  return {
    options,
    item: data?.item,
    preset: {
      host: url.searchParams.get("host") || "",
      ranges: url.searchParams.get("ranges") || "",
      ports: url.searchParams.get("ports") || "8006",
      fingerprint: url.searchParams.get("fingerprint") || "",
      port: url.searchParams.get("port") || "8006",
      transport: url.searchParams.get("transport") || "direct",
      mikrotikRecordId: url.searchParams.get("mikrotikRecordId") || "",
    },
  };
}
export async function resourceLoader({ params, request }) {
  const url = new URL(request.url);
  const section = url.searchParams.get("section");
  if (!["metrics", "events", "availability", "operations"].includes(section))
    throw new Response("Неизвестный раздел", { status: 404 });
  try {
    if (section === "operations") {
      const cursor = url.searchParams.get("cursor") || "";
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const result = await api(
        `/api/proxmox/guests/${params.id}/operations${query}`,
        { signal: request.signal },
      );
      return { ...result, resourceId: params.id, requestedCursor: cursor };
    }
    return await api(
      `/api/proxmox/resources/${params.id}/${section}?${url.searchParams}`,
      { signal: request.signal },
    );
  } catch (error) {
    if (error.status === 401) throw error;
    return { error: true, message: error.message };
  }
}
export async function action({ request, params }) {
  const body = await request.json();
  const { intent, ...payload } = body;
  try {
    if (intent === "cancelOperation") {
      const { resourceId, operationId } = payload;
      return await api(
        `/api/proxmox/guests/${encodeURIComponent(resourceId || params.id)}/operations/${encodeURIComponent(operationId)}/cancel`,
        { method: "POST", body: {} },
      );
    }
    if (intent === "reconcileOperation") {
      const { operationId, ...review } = payload;
      return await api(
        `/api/proxmox/guests/${params.id}/operations/${encodeURIComponent(operationId)}/reconcile`,
        {
          method: "POST",
          body: review,
        },
      );
    }
    if (intent === "connectionMonitoring")
      return await api(`/api/proxmox/connections/${params.id}/monitoring`, {
        method: "PATCH",
        body: payload,
      });
    if (intent === "archive") {
      await api(`/api/proxmox/connections/${params.id}`, { method: "DELETE" });
      return redirect(`${ROOT}/connections`);
    }
    if (intent === "verify")
      return await api("/api/proxmox/connections/verify", {
        method: "POST",
        body: payload,
      });
    if (intent === "connection") {
      const result = await api(
        `/api/proxmox/connections${params.id ? `/${params.id}` : ""}`,
        { method: params.id ? "PUT" : "POST", body: payload },
      );
      return redirect(
        `${ROOT}/connections/${result.item.id || result.item._id}`,
      );
    }
    if (intent === "networks")
      return await api(
        `/api/proxmox/discovery/networks?mikrotikRecordId=${encodeURIComponent(payload.mikrotikRecordId)}`,
      );
    if (intent === "discover")
      return await api("/api/proxmox/discovery/sessions", {
        method: "POST",
        body: payload,
      });
    if (intent === "cancelDiscovery" || intent === "closeDiscovery")
      return await api(
        `/api/proxmox/discovery/sessions/${encodeURIComponent(payload.sessionId)}${intent === "cancelDiscovery" ? "/cancel" : ""}`,
        { method: intent === "cancelDiscovery" ? "POST" : "DELETE" },
      );
    if (intent === "company")
      return await api(`/api/proxmox/${payload.kind}/${params.id}/company`, {
        method: "PATCH",
        body: { companyId: payload.companyId || null },
      });
    if (intent === "bulkCompany")
      return await api("/api/proxmox/guests/company", {
        method: "PATCH",
        body: payload,
      });
    if (intent === "operation") {
      const { resourceId, ...operation } = payload;
      const result = await api(
        `/api/proxmox/guests/${encodeURIComponent(resourceId || params.id)}/operations`,
        {
          method: "POST",
          body: operation,
        },
      );
      return {
        ...result,
        message: "Операция принята. Результат появится в журнале ВМ.",
      };
    }
    if (intent === "monitoring")
      return await api(`/api/proxmox/guests/${params.id}/monitoring`, {
        method: "PATCH",
        body: payload,
      });
    if (intent === "inventory")
      return await api(`/api/proxmox/resources/${params.id}/inventory-link`, {
        method: "PUT",
        body: payload,
      });
    if (intent === "maintenance")
      return await api(
        `/api/proxmox/${payload.kind === "connections" ? "connections" : "resources"}/${params.id}/maintenance`,
        { method: "PUT", body: payload },
      );
    throw new Error("Неизвестное действие");
  } catch (error) {
    if (error.status === 401) throw error;
    return {
      error: true,
      message: error.message,
      details: error.payload,
      sessionId: payload.clientSessionId || payload.sessionId,
    };
  }
}

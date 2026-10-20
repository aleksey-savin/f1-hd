import type { Can } from "@/lib/access";
import type {
  InventoryChangeLink,
  InventoryChangeResultState,
  InventoryChangeStatus,
  InventoryChangeSummary,
} from "@/types/inventoryChange";

import { plural } from "./plural.js";
import type { Tone } from "./mikrotik-changes";

// Предложения ИИ-агентов по инвентарю (страница предложения, блок «Главной»):
// тон статуса, ссылки в тексте операций, сводка диалога «Применить?», подпись
// результата. Чистые функции — проверяются node --test. Названия статусов
// сервер присылает сам (`statusLabel`).

const TONE_BY_STATUS: Record<InventoryChangeStatus, Tone> = {
  awaiting_requester: "wait",
  partial: "wait",
  applying: "info",
  done: "ok",
  failed: "bad",
  rejected: "idle",
  expired: "idle",
};

/** Применение прервано (stuck) — статус «Не применено», тон тот же, что у failed (макет 20.10). */
export const statusTone = (
  status: InventoryChangeStatus,
  stuck: boolean,
): Tone => (stuck ? "bad" : (TONE_BY_STATUS[status] ?? "idle"));

/**
 * Предложение открыто: ждёт автора и срок не вышел. Без срока или с битой
 * датой — истёкшее, как на сервере (changeView `open`). Между `expiresAt` и
 * обходом sweep статус ещё `awaiting_requester` — открытым это не считается.
 */
export const isOpenChange = (
  change: { status: InventoryChangeStatus; expiresAt?: string | null },
  now: Date = new Date(),
): boolean =>
  change.status === "awaiting_requester" &&
  !!change.expiresAt &&
  now.getTime() < new Date(change.expiresAt).getTime();

/** «1 операция», «3 операции», «9 операций». */
export const opsCount = (n: number): string =>
  `${n} ${plural(n, "операция", "операции", "операций")}`;

type Right = { res: string; action: string };
type Target = { path: string; right: Right };

const DEVICE: Right = { res: "device", action: "read" };
const CATALOG: Right = { res: "inventoryCatalog", action: "read" };
const SUPPLIER: Right = { res: "supplier", action: "read" };

// Страница и право на неё. Моделей, которых здесь нет (атрибут, группа, компания,
// человек, конфигурация — у неё нет своей страницы), ссылкой не бывает.
const TARGETS: Record<string, (id: string) => Target> = {
  ClientDevice: (id) => ({ path: `/inventory/client-devices/${id}`, right: DEVICE }),
  Location: (id) => ({ path: `/inventory/locations/${id}`, right: DEVICE }),
  DeviceModel: (id) => ({ path: `/inventory/device-models/${id}`, right: CATALOG }),
  DeviceType: (id) => ({ path: `/inventory/device-types/${id}`, right: CATALOG }),
  Vendor: (id) => ({ path: `/inventory/vendors/${id}`, right: CATALOG }),
  DeviceBuild: (id) => ({ path: `/inventory/device-builds/${id}`, right: CATALOG }),
  Supplier: (id) => ({ path: `/inventory/suppliers/${id}`, right: SUPPLIER }),
};

/** Адрес ссылки или null: страницы нет либо у человека нет права её открыть. */
export const linkFor = (
  link: Pick<InventoryChangeLink, "model" | "id">,
  can: Can,
): string | null => {
  const make = TARGETS[link.model];
  if (!make || !link.id) return null;
  const { path, right } = make(String(link.id));
  return can({ [right.res]: [right.action] }) ? path : null;
};

export type Segment = { text: string; to?: string };

/**
 * Режет текст по первому вхождению подписи каждой ссылки: сначала длинные, без
 * наложений. Подписи, которой в тексте нет, нет и в результате.
 */
export const segments = (
  text: string,
  links: InventoryChangeLink[],
  can: Can,
): Segment[] => {
  const source = String(text ?? "");
  const found: { start: number; end: number; to: string | null }[] = [];
  const byLength = [...(links || [])]
    .filter((l) => l?.label)
    .sort((a, b) => b.label.length - a.label.length);
  for (const link of byLength) {
    const start = source.indexOf(link.label);
    if (start < 0) continue;
    const end = start + link.label.length;
    if (found.some((f) => start < f.end && end > f.start)) continue;
    found.push({ start, end, to: linkFor(link, can) });
  }
  found.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const f of found) {
    if (f.start > at) out.push({ text: source.slice(at, f.start) });
    out.push({
      text: source.slice(f.start, f.end),
      ...(f.to ? { to: f.to } : {}),
    });
    at = f.end;
  }
  if (at < source.length) out.push({ text: source.slice(at) });
  return out;
};

// Создаваемое в винительном падеже; число 1 пишется без цифры. Порядок — как в макете.
const CREATE_FORMS: [keyof InventoryChangeSummary["create"], string, string, string][] = [
  ["type", "тип", "типа", "типов"],
  ["attribute", "атрибут", "атрибута", "атрибутов"],
  ["group", "группу", "группы", "групп"],
  ["vendor", "вендор", "вендора", "вендоров"],
  ["supplier", "поставщика", "поставщиков", "поставщиков"],
  ["model", "модель", "модели", "моделей"],
  ["configuration", "конфигурацию", "конфигурации", "конфигураций"],
  ["build", "сборку", "сборки", "сборок"],
  ["device", "устройство", "устройства", "устройств"],
];

const devices = (n: number) => plural(n, "устройство", "устройства", "устройств");

const joinList = (parts: string[]): string =>
  parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;

/** Заголовок и строки диалога «Применить N операций?». */
export const confirmSummary = (
  summary: {
    create?: Partial<InventoryChangeSummary["create"]>;
    change?: { count?: number; names?: string[] };
  },
  total: number,
): { title: string; items: string[] } => {
  const sides: string[] = [];
  const made = CREATE_FORMS.flatMap(([key, one, few, many]) => {
    const n = summary?.create?.[key] ?? 0;
    if (n <= 0) return [];
    return [n === 1 ? one : `${n} ${plural(n, one, few, many)}`];
  });
  if (made.length) sides.push(`создать: ${joinList(made)}`);

  const names = summary?.change?.names;
  const count = summary?.change?.count ?? 0;
  if (names?.length) sides.push(`изменить: ${names.join(", ")}`);
  else if (count > 0) sides.push(`изменить: ${count} ${devices(count)}`);

  const items = sides.map((s, i) => `${s}${i === sides.length - 1 ? "." : ";"}`);
  return {
    title: `Применить ${total} ${plural(total, "операцию", "операции", "операций")}?`,
    items,
  };
};

export type ResultLabel = { tone: "ok" | "bad" | "idle" | "wait"; text: string };

/** Подпись результата операции. `stuck` — применение прервано, итог неизвестен. */
export const resultLabel = (
  result: { state: InventoryChangeResultState; error?: string },
  stuck: boolean,
): ResultLabel => {
  if (result.state === "done") return { tone: "ok", text: "✓ Выполнено" };
  if (result.state === "failed") {
    return {
      tone: "bad",
      text: result.error ? `✗ Не выполнено: ${result.error}` : "✗ Не выполнено",
    };
  }
  if (stuck) return { tone: "wait", text: "Результат неизвестен" };
  return {
    tone: "idle",
    text: result.error ? `Не выполнялась: ${result.error}` : "Не выполнялась",
  };
};

// Право на созданное: у конфигурации своей страницы нет, её `to` ведёт на
// страницу модели — и право то же, что у модели.
const CREATED_RIGHT_AS: Record<string, string> = {
  DeviceConfiguration: "DeviceModel",
};

/**
 * Адрес созданного или null. `to` бэкенд уже разрешил (нет — документ удалён
 * или страницы нет); право на страницу проверяется здесь, как у linkFor.
 */
export const createdTo = (
  item: { model: string; id: string; to?: string },
  can: Can,
): string | null => {
  if (!item?.to) return null;
  const model = CREATED_RIGHT_AS[item.model] ?? item.model;
  return linkFor({ model, id: item.id }, can) ? item.to : null;
};

const numbers = (list: number[]): string =>
  list.length > 1 && list[list.length - 1] - list[0] === list.length - 1
    ? `${list[0]}–${list[list.length - 1]}`
    : list.join(", ");

/** Плашка «Применено K из N операций»: какая операция не прошла и что не выполнялось. */
export const partialNote = (
  operations: { result: { state: InventoryChangeResultState } }[],
): { title: string; body: string } => {
  const total = operations.length;
  const done = operations.filter((op) => op.result?.state === "done").length;
  const failed = operations.findIndex((op) => op.result?.state === "failed");
  const title = `Применено ${done} из ${total} ${plural(total, "операции", "операций", "операций")}`;
  const rest = "Сделанное остаётся — остаток агент может предложить заново.";
  if (failed < 0) return { title, body: rest };

  const skipped = operations
    .map((op, index) => ({ state: op.result?.state, n: index + 1 }))
    .filter((op, index) => index > failed && op.state !== "done" && op.state !== "failed")
    .map((op) => op.n);
  const tail = !skipped.length
    ? "."
    : skipped.length === 1
      ? `: операция ${skipped[0]} не выполнялась.`
      : `: операции ${numbers(skipped)} не выполнялись.`;
  return {
    title,
    body: `Операция ${failed + 1} не прошла, и HD остановил применение${tail} ${rest}`,
  };
};

import { cloneElement, isValidElement, useEffect, useId } from "react";
import { useLocation, useNavigate, useRevalidator } from "react-router";
import AppField from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Panel, Eyebrow, Section as AppSection } from "@/components/app/Panel";
import { formatShortDateTime } from "@/util/format-date";
import { cn } from "@/lib/utils";
import { ROOT, labels } from "./data";
export const idOf = (item) =>
  typeof item === "string" ? item : String(item?.id || item?._id || "");
export const nameOf = (item) =>
  typeof item === "string"
    ? item
    : item?.name ||
      item?.alias ||
      item?.fullTitle ||
      item?.title ||
      item?.label ||
      "—";
export const optionsOf = (items = []) =>
  items.map((x) => ({ value: idOf(x), label: nameOf(x) }));
export const bytes = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(
        n / 1024 ** 3,
      ) + " ГБ";
export const date = (v) => formatShortDateTime(v) || "—";
export const percent = (n) =>
  n == null
    ? "—"
    : `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(n)}%`;
export const duration = (ms) => {
  if (ms == null) return "—";
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return "Менее минуты";
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 1440)
    return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  return `${Math.floor(minutes / 1440)} д ${Math.floor((minutes % 1440) / 60)} ч`;
};
export const operationNames = {
  start: "Запуск ВМ",
  shutdown: "Выключение ВМ",
  reboot: "Перезагрузка ВМ",
  backup: "Резервное копирование",
};
export const tlsNames = {
  system: "Доверенный сертификат",
  ca: "Свой центр сертификации",
  fingerprint: "Проверка отпечатка",
  insecure: "Без проверки сертификата",
};
export const titleOf = (item) => nameOf(item);
export function Navigation() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const current = pathname.split("/")[3] || "guests";
  const sections = ["guests", "nodes", "storages"];
  return (
    <Segmented
      ariaLabel="Раздел Proxmox"
      compact
      fit
      value={current}
      options={sections.map((value) => ({ value, label: labels[value] }))}
      onChange={(value) => {
        if (!value || value === current) return;
        const next = new URLSearchParams();
        const company = new URLSearchParams(search).get("companyId");
        if (company && (company !== "unassigned" || value === "guests"))
          next.set("companyId", company);
        navigate(`${ROOT}/${value}${next.size ? `?${next}` : ""}`);
      }}
    />
  );
}
// Adapt the domain forms to the application's Field; ids also connect popover controls to labels.
export function Field({ label, children, htmlFor, ...props }) {
  const generated = useId();
  const id =
    htmlFor ||
    (isValidElement(children) ? children.props.id : null) ||
    generated;
  return (
    <AppField label={label} htmlFor={id} {...props}>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
    </AppField>
  );
}
export function TextField({ label, hint, error, required, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <Input {...props} aria-invalid={Boolean(error) || undefined} />
    </Field>
  );
}
export function Section({ title, id, children, action }) {
  return (
    <AppSection>
      <Eyebrow id={id} action={action}>
        {title}
      </Eyebrow>
      <Panel>{children}</Panel>
    </AppSection>
  );
}
export function Feedback({ data }) {
  return data?.message ? (
    <Alert
      role={data.error ? "alert" : "status"}
      variant={data.error ? "destructive" : "success"}
      className="my-4"
    >
      <AlertDescription>{data.message}</AlertDescription>
    </Alert>
  ) : null;
}
const statusLabels = {
  running: "Работает",
  stopped: "Остановлена",
  online: "Доступен",
  available: "Доступно",
  unavailable: "Недоступно",
  offline: "Недоступен",
  unknown: "Нет свежих данных",
  stale: "Нет свежих данных",
  queued: "В очереди",
  dispatching: "Отправляется",
  succeeded: "Завершено",
  reviewed: "Проверено вручную",
  completed: "Завершено",
  done: "Завершено",
  failed: "Ошибка",
  cancelled: "Отменено",
  needsReview: "Требует проверки",
  interrupted: "Прервано",
  paused: "Приостановлено",
};
export function Status({ item }) {
  const stale = item.freshness === "stale" || item.freshness === "unknown";
  const state = stale ? "unknown" : item.state || item.status;
  let label = statusLabels[state] || "Не проверено";
  let tone = [
    "online",
    "running",
    "succeeded",
    "done",
    "completed",
    "available",
  ].includes(state)
    ? "text-accent-text"
    : ["offline", "failed", "unavailable"].includes(state)
      ? "text-destructive"
      : "text-muted-foreground";
  if (item.monitoringEnabled === false) {
    label = "Мониторинг выключен";
    tone = "text-muted-foreground";
  } else if (item.monitoringPausedByConnection) {
    label = "Подключение выключено";
    tone = "text-muted-foreground";
  } else if (item.template) {
    label = "Шаблон";
    tone = "text-muted-foreground";
  } else if (item.operation && ["unknown", "needsReview"].includes(state)) {
    label = "Требует проверки";
    tone = "text-warning";
  } else if (item.operation && state === "running") label = "Выполняется";
  else if (
    item.cancelRequested &&
    !["completed", "cancelled", "failed"].includes(state)
  )
    label = "Останавливается";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        tone,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
export function useRefresh(milliseconds = 60000) {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!milliseconds) return undefined;
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        revalidator.state === "idle"
      )
        revalidator.revalidate();
    }, milliseconds);
    return () => clearInterval(timer);
  }, [milliseconds, revalidator]);
}
export function Properties({ items }) {
  return (
    <dl className="divide-y divide-border-soft">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-3 sm:gap-4"
        >
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-sm font-medium sm:col-span-2">
            {value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

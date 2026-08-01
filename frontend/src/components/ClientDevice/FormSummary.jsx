import { DEVICE_STATUS_META } from "@/components/app/device-status";

// Строка сводки: пока шаг не пройден — приглушённая подсказка, где это спросят.
const Row = ({ label, value, pending }) => (
  <div className="flex gap-2.5 border-t border-border-soft py-1.5 text-sm first:border-t-0">
    <span className="w-24 flex-none text-muted-foreground">{label}</span>
    <span
      className={
        value ? "min-w-0 flex-1 font-medium" : "min-w-0 flex-1 text-faint"
      }
    >
      {value || pending || "—"}
    </span>
  </div>
);

/**
 * Живая сводка мастера: что именно заводим — видно на каждом шаге, а не только
 * в конце. Незаполненное показывается тем, где его спросят («шаг 2»), — так
 * видно и то, что уже собрано, и то, что осталось.
 */
const FormSummary = ({ form, deviceKind, labels }) => {
  const identity =
    deviceKind === "custom"
      ? labels.deviceType || null
      : [labels.deviceType, labels.vendor, labels.model]
          .filter(Boolean)
          .join(" ") || null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2.5 text-xs font-bold tracking-wider text-faint uppercase">
        Устройство
      </div>
      <Row label="Что заводим" value={identity} pending="шаг 1" />
      {deviceKind === "branded" && (
        <Row label="Конфигурация" value={labels.configuration} pending="—" />
      )}
      <Row label="Серийный №" value={form.serialNumber} pending="не указан" />
      <Row
        label="Инв. №"
        value={form.inventoryNumber}
        pending="присвоится автоматически"
      />
      <Row label="Компания" value={labels.company} pending="шаг 2" />
      <Row label="Размещение" value={labels.location} pending="шаг 2" />
      <Row
        label="Статус"
        value={DEVICE_STATUS_META[form.status]?.label}
        pending="шаг 2"
      />
      {form.status === "deployed" && (
        <Row label="Кому" value={labels.user} pending="шаг 2" />
      )}
      <Row
        label="Закупка"
        value={
          form.purchasedAt || form.price
            ? [
                form.purchasedAt,
                form.price
                  ? `${Number(form.price).toLocaleString("ru-RU")} ₽`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : null
        }
        pending="шаг 3"
      />
    </div>
  );
};

export default FormSummary;

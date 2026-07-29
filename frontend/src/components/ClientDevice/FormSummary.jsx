import { DEVICE_STATUS_META } from "@/components/app/device-status";

// Строка сводки: пока шаг не пройден — приглушённая подсказка, где это спросят.
const Row = ({ label, value, pending }) => (
  <div className="tw:flex tw:gap-2.5 tw:border-t tw:border-border-soft tw:py-1.5 tw:text-sm tw:first:border-t-0">
    <span className="tw:w-24 tw:flex-none tw:text-muted-foreground">
      {label}
    </span>
    <span
      className={
        value
          ? "tw:min-w-0 tw:flex-1 tw:font-medium"
          : "tw:min-w-0 tw:flex-1 tw:text-faint"
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
    <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-4">
      <div className="tw:mb-2.5 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
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

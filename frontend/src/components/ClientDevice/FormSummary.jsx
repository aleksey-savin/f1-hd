import { DEVICE_STATUS_META } from "@/components/app/device-status";
import { partsCountLabel } from "./device-parts";

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
 * видно и то, что уже собрано, и то, что осталось. Номер шага — по ключу
 * (`stepOf`): шаг «Комплектующие» сдвигает остальные. `partsCount` — число
 * деталей нового ПК своей сборки, null — шага нет (тогда нет и строки
 * «Сборка»).
 */
const FormSummary = ({
  form,
  deviceKind,
  labels,
  stepOf,
  partsCount = null,
}) => {
  const pendingAt = (key) => `шаг ${stepOf(key)}`;
  const identity =
    deviceKind === "custom"
      ? labels.deviceType
        ? `${labels.deviceType} · своя сборка`
        : null
      : [labels.deviceType, labels.vendor, labels.model]
          .filter(Boolean)
          .join(" ") || null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2.5 text-xs font-bold tracking-wider text-faint uppercase">
        Устройство
      </div>
      <Row label="Что заводим" value={identity} pending={pendingAt("device")} />
      {deviceKind === "branded" && (
        <Row label="Конфигурация" value={labels.configuration} pending="—" />
      )}
      {partsCount !== null && (
        <>
          <Row label="Сборка" value={labels.build} pending="—" />
          <Row
            label="Детали"
            value={partsCount ? partsCountLabel(partsCount) : null}
            pending={pendingAt("parts")}
          />
        </>
      )}
      <Row
        label="Серийный номер"
        value={form.serialNumber}
        pending="не указан"
      />
      <Row
        label="Инв. номер"
        value={form.inventoryNumber}
        pending="присвоится автоматически"
      />
      <Row
        label="Компания"
        value={labels.company}
        pending={pendingAt("placement")}
      />
      <Row
        label="Размещение"
        value={labels.location}
        pending={pendingAt("placement")}
      />
      <Row
        label="Статус"
        value={DEVICE_STATUS_META[form.status]?.label}
        pending={pendingAt("placement")}
      />
      {form.status === "deployed" && (
        <Row
          label="Кому"
          value={labels.user}
          pending={pendingAt("placement")}
        />
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
        pending={pendingAt("purchase")}
      />
    </div>
  );
};

export default FormSummary;

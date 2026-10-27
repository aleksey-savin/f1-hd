import { cn } from "@/lib/utils";

// Подстрока устройства в окружении (строка списка и плитка плана): имя
// устройства в сети (нет — инвентарный номер), затем ключевые характеристики
// своей сборки — иначе тип · вендор. Тип, уже ставший именем (сборка без модели),
// не повторяется: «Системный блок / Системный блок» ничего не различает.
const EnvironmentDeviceMeta = ({ device, className }) => {
  const kind =
    device.keySpecs ||
    [
      device.typeName !== device.name ? device.typeName : null,
      device.vendorName,
    ]
      .filter(Boolean)
      .join(" · ");
  const label = device.hostname || device.inventoryNumber;
  if (!label && !kind) return null;

  return (
    <span
      className={cn("block truncate text-xs text-muted-foreground", className)}
      title={[label, kind].filter(Boolean).join(" · ")}
    >
      {label && (
        <span className="font-mono font-medium tabular-nums">{label}</span>
      )}
      {label && kind && " · "}
      {device.keySpecs ? (
        <span className="font-medium text-foreground">{device.keySpecs}</span>
      ) : (
        kind
      )}
    </span>
  );
};

export default EnvironmentDeviceMeta;

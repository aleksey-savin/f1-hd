import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  RiDeleteBinLine,
  RiEdit2Line,
  RiMoreLine,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiShieldFlashLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeviceStatusText } from "@/components/app/device-status";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";

import ConfirmDialog from "./ConfirmDialog";
import UptimeBar from "./UptimeBar";
import {
  DeviceTile,
  STATUS_META,
  daySegments,
  formatDurationShort,
  formatUptime,
  uptimeToneClass,
} from "./meta";
import useMikrotikDeviceFilterStore, {
  rowStatus,
} from "../../store/lists/mikrotik-devices";

// Строка борда мониторинга — жёсткие колонки: плитка с live-точкой · имя + мета
// · хост · прошивка · доступность (лента 30 дней) · статус · гнездо «⋯».
// Геометрия — строка списка с плиткой (`app/ListRow`): плитка 48 без кольца,
// заголовок 16, разделители от края плитки, гнездо 56 px с приглушённым глифом
// по наведению. Статус — тихим форматом (точка + слово) тем же компонентом, что
// в реестре устройств: один факт «в сети / не в сети» — один вид.
//
// Клик ведёт на страницу записи — правило всего приложения. Шторка-превью
// снята 08.09: запись плоская, всё, что показывала шторка, есть на странице, а
// промежуточный щелчок мешал каждый раз (тот же вывод, что у заявок 30.07).
// Строка — настоящая ссылка: Cmd/Ctrl+клик и средний клик открывают её в новой
// вкладке; «⋯» лежит снаружи ссылки (интерактивное внутри ссылки невалидно).
// Действия гнезда — те, что были в шторке: изменить, включить/отключить
// мониторинг, удалить (диалог — вне radix-меню, иначе размонтируется вместе с
// ним). На телефоне гнезда нет: правка и удаление живут на странице записи,
// куда ведёт тап; колонки добираются с md/lg.
const DeviceRow = ({ row, canManage }) => {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.showToast);
  const connectRecord = useMikrotikDeviceFilterStore(
    (state) => state.connectRecord,
  );
  const disconnectRecord = useMikrotikDeviceFilterStore(
    (state) => state.disconnectRecord,
  );
  const deleteRecord = useMikrotikDeviceFilterStore(
    (state) => state.deleteRecord,
  );

  const [showDelete, setShowDelete] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const status = rowStatus(row);
  const statusMeta = STATUS_META[status] || STATUS_META.offline;
  const dimmed = status === "disabled";

  const meta = [
    row.type,
    row.company?.name,
    row.model?.name,
    row.location?.name,
  ]
    .filter(Boolean)
    .join(" · ");

  const firmware = row.firmwareStatus;
  const installedVersion = firmware?.installedVersion || row.currentFirmware;

  const uptimeText = formatUptime(row.uptime30d);
  const monitoredDays = Array.isArray(row.uptimeDays)
    ? row.uptimeDays.filter((day) => day != null).length
    : null;
  const offlineFor =
    status === "offline" && row.offlineSince
      ? formatDurationShort(Date.now() - new Date(row.offlineSince).getTime())
      : null;

  const toggleMonitoring = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const action = status === "disabled" ? connectRecord : disconnectRecord;
      const response = await action(row.recordId);
      const data = await response.json().catch(() => ({}));
      showToast(
        response.ok ? "success" : "danger",
        data.message ||
          (response.ok ? "Готово" : "Не удалось выполнить действие"),
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const response = await deleteRecord(row.recordId);
      const data = await response.json().catch(() => ({}));
      showToast(
        response.ok ? "success" : "danger",
        data.message ||
          (response.ok
            ? "Устройство удалено из мониторинга"
            : "Не удалось удалить устройство"),
      );
      if (response.ok) setShowDelete(false);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex items-center transition-colors",
        // Разделитель — от правого края плитки (20 + 48 + 16), как у любой
        // строки с плиткой
        "before:absolute before:top-0 before:right-5 before:left-21 before:h-px before:bg-border-soft first:before:hidden",
        "hover:bg-accent/60",
        dimmed && "opacity-70",
      )}
    >
      <Link
        to={`/devices/mikrotik/records/${row.recordId}`}
        className="flex min-w-0 flex-1 items-center gap-4 py-3 ps-5 pe-5 text-foreground no-underline outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 md:pe-0"
      >
        <DeviceTile row={row} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-tight font-medium">
            {row.displayName}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {meta || "—"}
          </span>
          {/* Узкий экран: статус подстрокой, как у строки устройств */}
          <span className="mt-0.5 flex items-center gap-1.5 md:hidden">
            <DeviceStatusText tone={statusMeta.tone}>
              {statusMeta.label}
            </DeviceStatusText>
            {offlineFor && (
              <span className="text-xs text-muted-foreground">
                · {offlineFor}
              </span>
            )}
          </span>
        </span>

        <span className="hidden w-44 flex-none lg:block">
          <span className="block truncate font-mono text-sm">
            {row.host || <span className="text-faint">—</span>}
          </span>
          {row.jump && (
            <span className="block truncate text-xs text-faint">
              через {row.jump.name || "устройство"}
            </span>
          )}
        </span>

        <span className="hidden w-28 flex-none md:block">
          <span className="block truncate font-mono text-sm">
            {installedVersion || <span className="text-faint">—</span>}
          </span>
          {firmware?.vulnerable ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-warning">
              <RiShieldFlashLine size={12} aria-hidden />
              уязвимость
            </span>
          ) : firmware?.updateAvailable ? (
            <span className="block truncate text-xs text-faint">
              → {firmware.latestVersion}
            </span>
          ) : null}
        </span>

        <span className="hidden w-40 flex-none md:block">
          <UptimeBar
            segments={daySegments(row.uptimeDays, {
              ongoing: status === "offline",
            })}
          />
          <span
            className={cn(
              "block text-xs tabular-nums",
              uptimeToneClass(row.uptime30d),
            )}
          >
            {uptimeText || "—"}
            {uptimeText && monitoredDays != null && monitoredDays < 30 && (
              <span className="text-faint"> · {monitoredDays} дн</span>
            )}
          </span>
        </span>

        {/* Статус — тихим форматом; длительность офлайна под словом,
            с отступом на точку и зазор */}
        <span className="hidden w-32 flex-none md:block">
          <DeviceStatusText tone={statusMeta.tone} className="text-sm">
            {statusMeta.label}
          </DeviceStatusText>
          {offlineFor && (
            <span className="block ps-3 text-xs text-muted-foreground">
              {offlineFor}
            </span>
          )}
        </span>
      </Link>

      {/* Гнездо «⋯» — идиома строки списка: постоянная ширина, воздух от края,
          приглушённый глиф только по наведению (на тач-экране — всегда) */}
      <span className="hidden w-14 flex-none justify-center pe-4 md:flex">
        {canManage && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Действия"
                  title="Действия"
                  className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    navigate(`/devices/mikrotik/update/${row.recordId}`)
                  }
                >
                  <RiEdit2Line /> Изменить
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isBusy} onClick={toggleMonitoring}>
                  {status === "disabled" ? (
                    <>
                      <RiPlayCircleLine /> Включить мониторинг
                    </>
                  ) : (
                    <>
                      <RiPauseCircleLine /> Отключить мониторинг
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setShowDelete(true)}
                >
                  <RiDeleteBinLine /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDialog
              open={showDelete}
              onOpenChange={setShowDelete}
              title={row.displayName}
              description={
                row.clientDeviceId
                  ? "Запись мониторинга, учётные данные и сохранённые копии конфигураций будут удалены. Карточка в инвентаре останется."
                  : "Запись мониторинга, учётные данные и сохранённые копии конфигураций будут удалены безвозвратно."
              }
              onConfirm={handleDelete}
              isLoading={isBusy}
            />
          </>
        )}
      </span>
    </div>
  );
};

export default DeviceRow;

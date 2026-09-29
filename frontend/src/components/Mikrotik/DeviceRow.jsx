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
import { Checkbox } from "@/components/ui/checkbox";
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
import { rowUpgradeView } from "./upgrade-format.js";
import useMikrotikDeviceFilterStore, {
  rowStatus,
} from "../../store/lists/mikrotik-devices";
import { formatTime } from "../../util/format-date";

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
const DeviceRow = ({
  row,
  canManage,
  selectionActive = false,
  isSelected = false,
  onToggle,
  pressProps,
  consumeSuppressedClick,
}) => {
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

  // Режим выбора (hooks/use-list-selection): клик по строке выбирает, а не
  // открывает запись; долгий тап на телефоне включает режим.
  const handleLinkClick = (event) => {
    if (consumeSuppressedClick?.()) {
      event.preventDefault();
      return;
    }
    if (selectionActive) {
      event.preventDefault();
      onToggle?.(row.recordId, { range: event.shiftKey });
    }
  };

  // Строка во время пакета обновления (макет, экран 3): «Обновляется» со
  // шагом, «в очереди», «обновлено в HH:MM», «не обновлено». После пакета —
  // обычная строка.
  const upgradeView = rowUpgradeView(row.upgrade);

  return (
    <div
      className={cn(
        "longpress-target group relative flex items-center transition-colors",
        // Разделитель — от правого края плитки (20 + 48 + 16), в режиме выбора —
        // ещё на 32 px правее (строка сдвигается под чекбокс)
        "before:absolute before:top-0 before:right-5 before:h-px before:bg-border-soft first:before:hidden",
        selectionActive ? "before:left-29" : "before:left-21",
        isSelected ? "bg-primary/10" : "hover:bg-accent/60",
        dimmed && "opacity-70",
      )}
      {...(pressProps || {})}
    >
      {selectionActive && (
        <Checkbox
          checked={isSelected}
          aria-label={`Выбрать ${row.displayName}`}
          onClick={(event) =>
            onToggle?.(row.recordId, { range: event.shiftKey })
          }
          className="absolute start-4 top-1/2 z-10 -translate-y-1/2 md:start-5"
        />
      )}
      <Link
        to={`/devices/mikrotik/records/${row.recordId}`}
        onClick={handleLinkClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-4 py-3 pe-5 text-foreground no-underline outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 md:pe-0",
          selectionActive ? "ps-13" : "ps-5",
        )}
      >
        <DeviceTile row={row} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-tight font-medium">
            {row.displayName}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {meta || "—"}
          </span>
          {/* Узкий экран: статус подстрокой, как у строки устройств. Колонки
              прошивки тут нет, поэтому отставание и уязвимость — хвостом
              статуса (иначе фильтр «отстают» на телефоне нечем проверить);
              актуальная прошивка ничего не добавляет */}
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 whitespace-nowrap md:hidden">
            {upgradeView?.kind === "running" ? (
              <DeviceStatusText tone="info" className="text-info-text">
                Обновляется
              </DeviceStatusText>
            ) : (
              <DeviceStatusText tone={statusMeta.tone}>
                {statusMeta.label}
              </DeviceStatusText>
            )}
            {upgradeView?.kind === "running" && (
              <span className="text-xs text-muted-foreground">
                · {upgradeView.sub}
              </span>
            )}
            {upgradeView?.kind === "queued" && (
              <span className="text-xs text-faint">· в очереди</span>
            )}
            {upgradeView?.kind === "done" && (
              <span className="text-xs text-faint">
                · обновлено до {installedVersion}
              </span>
            )}
            {upgradeView?.kind === "failed" && (
              <span className="text-xs font-semibold text-destructive">
                · не обновлено
              </span>
            )}
            {offlineFor && (
              <span className="text-xs text-muted-foreground">
                · {offlineFor}
              </span>
            )}
            {!upgradeView &&
              (firmware?.vulnerable ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-warning">
                  · <RiShieldFlashLine size={12} aria-hidden />
                  уязвимость
                </span>
              ) : firmware?.updateAvailable && installedVersion ? (
                <span className="min-w-0 truncate font-mono text-xs text-faint">
                  · {installedVersion} → {firmware.latestVersion}
                </span>
              ) : null)}
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
          {upgradeView?.kind === "done" ? (
            <span className="block truncate text-xs text-faint">
              обновлено в {formatTime(upgradeView.finishedAt)}
            </span>
          ) : upgradeView?.kind === "failed" ? (
            <span className="block truncate text-xs font-semibold text-destructive">
              не обновлено
            </span>
          ) : firmware?.vulnerable ? (
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
          {upgradeView?.kind === "running" ? (
            <>
              <DeviceStatusText tone="info" className="text-sm text-info-text">
                Обновляется
              </DeviceStatusText>
              <span className="block ps-3 text-xs text-muted-foreground">
                {upgradeView.sub}
              </span>
            </>
          ) : (
            <>
              <DeviceStatusText tone={statusMeta.tone} className="text-sm">
                {statusMeta.label}
              </DeviceStatusText>
              {offlineFor && (
                <span className="block ps-3 text-xs text-muted-foreground">
                  {offlineFor}
                </span>
              )}
              {upgradeView?.kind === "queued" && (
                <span className="block ps-3 text-xs text-faint">в очереди</span>
              )}
            </>
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

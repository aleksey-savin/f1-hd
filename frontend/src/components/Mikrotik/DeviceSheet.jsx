import { useState } from "react";
import { Link, useNavigate } from "react-router";

import {
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiMoreLine,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiPulseLine,
  RiShieldFlashLine,
} from "react-icons/ri";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";
import useOffcanvasStore from "@/store/offcanvas";

import ConfirmDialog from "./ConfirmDialog";
import UptimeBar from "./UptimeBar";
import {
  DeviceTile,
  STATUS_META,
  daySegments,
  formatAgo,
  formatDurationShort,
  formatSchedule,
  formatUptime,
  uptimeToneClass,
} from "./meta";
import useMikrotikDeviceFilterStore, {
  rowStatus,
} from "../../store/lists/mikrotik-devices";
import { formatDate, formatShortDate } from "../../util/format-date";

const dash = <span className="text-faint">—</span>;

// Микро-метка секции шторки.
const SectionLabel = ({ children }) => (
  <div className="mt-5 mb-1.5 text-xs font-bold tracking-wider text-faint uppercase">
    {children}
  </div>
);

// Строка «подпись · значение» шторки (+ копирование с тостом).
const Prop = ({ label, mono, copy, children }) => (
  <div className="flex items-start gap-3 border-t border-border-soft py-2 first:border-t-0">
    <div className="w-36 flex-none pt-px text-sm text-muted-foreground">
      {label}
    </div>
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 text-sm",
        mono && "font-mono",
      )}
    >
      <span className="min-w-0 truncate">{children ?? dash}</span>
      {copy && (
        <button
          type="button"
          title="Скопировать"
          aria-label="Скопировать"
          onClick={() => {
            navigator.clipboard?.writeText(copy.value).then(
              () =>
                useToastStore
                  .getState()
                  .showToast("success", `${copy.label} скопирован`),
              () =>
                useToastStore
                  .getState()
                  .showToast("danger", "Не удалось скопировать"),
            );
          }}
          className="grid size-6 flex-none cursor-pointer appearance-none place-items-center rounded-md border-0 bg-transparent p-0 text-faint transition-colors hover:bg-accent hover:text-muted-foreground"
        >
          <RiFileCopyLine size={13} />
        </button>
      )}
    </div>
  </div>
);

// Шторка-превью устройства (клик по строке списка): «заглянуть, не уходя» —
// статус с длительностью и последней ошибкой, авто-заявка эпизода, прошивка с
// CVE, доступность за 30 дней, свойства подключения. Главное действие —
// «Открыть устройство»; правка/мониторинг/удаление — в «⋯».
const DeviceSheet = ({ row, onClose, canManage }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
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

  const status = row ? rowStatus(row) : "offline";
  const statusMeta = STATUS_META[status] || STATUS_META.offline;
  const firmware = row?.firmwareStatus;
  const exportSchedule = formatSchedule(row?.schedules?.export);

  const toggleMonitoring = async () => {
    if (!row || isBusy) return;
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
    if (!row || isBusy) return;
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
      if (response.ok) {
        setShowDelete(false);
        onClose();
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={Boolean(row)}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent side="right" className="w-11/12 max-w-md">
          {row && (
            <>
              <div className="flex items-center gap-3 px-5 pt-4 pr-10">
                <DeviceTile row={row} />
                <div className="min-w-0">
                  <SheetTitle className="my-0 truncate text-lg leading-snug font-semibold tracking-tight">
                    {row.displayName}
                  </SheetTitle>
                  <div className="truncate text-sm text-muted-foreground">
                    {[row.type, row.company?.name]
                      .filter(Boolean)
                      .join(" · ") || "Устройство Mikrotik"}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-4">
                {/* Статус: слово с точкой + длительность; детали — приглушённо */}
                <div
                  className={cn(
                    "mt-3.5 flex items-center gap-2 font-semibold",
                    statusMeta.text,
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      statusMeta.dot,
                      status === "online" && "ring-3 ring-primary/20",
                    )}
                  />
                  {statusMeta.label}
                  {status === "offline" && row.offlineSince && (
                    <span className="font-semibold">
                      ·{" "}
                      {formatDurationShort(
                        Date.now() - new Date(row.offlineSince).getTime(),
                      )}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 ps-4 text-sm text-muted-foreground">
                  {status === "offline" && row.offlineSince && (
                    <>с {formatDate(row.offlineSince)} · </>
                  )}
                  {status === "disabled"
                    ? "фоновые проверки остановлены"
                    : row.lastCheckedAt
                      ? `проверка ${formatAgo(row.lastCheckedAt)}`
                      : "ещё не проверялось"}
                </div>
                {status === "offline" && row.lastError && (
                  <div className="mt-0.5 ps-4 font-mono text-xs text-faint">
                    {row.lastError}
                  </div>
                )}
                {status === "offline" && row.alertTicket && (
                  <Link
                    to={`/tickets/${row.alertTicket.num}`}
                    onClick={onClose}
                    className="mt-2.5 flex items-center gap-2.5 rounded-lg border border-border-soft bg-accent/40 px-3 py-2 text-sm text-muted-foreground no-underline transition-colors hover:bg-accent"
                  >
                    <RiPulseLine size={15} aria-hidden className="flex-none" />
                    <span className="min-w-0 truncate">
                      Заявка{" "}
                      <b className="font-semibold text-accent-text">
                        №{row.alertTicket.num}
                      </b>{" "}
                      о недоступности
                      {row.offlineAlertedAt && (
                        <> · {formatAgo(row.offlineAlertedAt)}</>
                      )}
                    </span>
                    <RiExternalLinkLine
                      size={13}
                      aria-hidden
                      className="ms-auto flex-none text-faint"
                    />
                  </Link>
                )}

                <SectionLabel>Прошивка и безопасность</SectionLabel>
                <div className="text-sm">
                  <span className="font-mono font-semibold">
                    RouterOS{" "}
                    {firmware?.installedVersion || row.currentFirmware || "—"}
                  </span>
                  {firmware?.channel && (
                    <span className="text-faint">
                      {" "}
                      · ветка {firmware.channel}
                    </span>
                  )}
                </div>
                {firmware?.vulnerable ? (
                  <>
                    <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-warning">
                      <RiShieldFlashLine size={14} aria-hidden />
                      {firmware.cves.length === 1
                        ? "1 уязвимость"
                        : `Уязвимости: ${firmware.cves.length}`}{" "}
                      · исправлены в {firmware.latestVersion}
                    </div>
                    <div className="mt-1">
                      {firmware.cves.slice(0, 3).map((cve) => (
                        <div
                          key={cve.id}
                          className="flex items-baseline gap-2 border-t border-border-soft py-1.5 text-sm first:border-t-0"
                        >
                          <span className="font-mono">{cve.id}</span>
                          <span
                            className={cn(
                              "flex-none font-semibold whitespace-nowrap",
                              cve.score >= 9
                                ? "text-destructive"
                                : "text-warning",
                            )}
                          >
                            {cve.score} {cve.severity?.toLowerCase()}
                          </span>
                          <span className="min-w-0 truncate text-xs text-faint">
                            {cve.description}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : firmware?.updateAvailable ? (
                  <div className="mt-1 text-sm text-muted-foreground">
                    Доступно обновление до{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {firmware.latestVersion}
                    </span>
                  </div>
                ) : firmware ? (
                  <div className="mt-1 text-sm text-faint">
                    Актуальная версия ветки.
                  </div>
                ) : null}

                <SectionLabel>Доступность · 30 дней</SectionLabel>
                <UptimeBar
                  segments={daySegments(row.uptimeDays, {
                    ongoing: status === "offline",
                  })}
                />
                <div className="mt-1.5 text-sm">
                  <span
                    className={cn(
                      "tabular-nums",
                      uptimeToneClass(row.uptime30d),
                    )}
                  >
                    {formatUptime(row.uptime30d) || "—"}
                  </span>
                  <span className="text-faint">
                    {" "}
                    · полный отчёт — на странице устройства
                  </span>
                </div>

                <SectionLabel>Подключение</SectionLabel>
                <Prop
                  label="Хост"
                  mono
                  copy={row.host ? { value: row.host, label: "Хост" } : null}
                >
                  {row.host}
                  {row.port ? `:${row.port}` : ""}
                </Prop>
                {row.jump && (
                  <Prop label="Подключение">
                    через {row.jump.name || "устройство"} (SSH-туннель)
                  </Prop>
                )}
                <Prop label="Модель">
                  {row.model?.name || row.boardName || null}
                  {row.model?.name &&
                  row.boardName &&
                  row.model.name !== row.boardName
                    ? ` · ${row.boardName}`
                    : ""}
                </Prop>
                <Prop
                  label="Серийный номер"
                  mono
                  copy={
                    row.serialNumber
                      ? { value: row.serialNumber, label: "Серийный номер" }
                      : null
                  }
                >
                  {row.serialNumber}
                </Prop>
                {row.location && (
                  <Prop label="Расположение">{row.location.name}</Prop>
                )}
                <Prop label="Карточка инвентаря">
                  {row.clientDeviceId ? (
                    <Link
                      to={`/inventory/client-devices/${row.clientDeviceId}`}
                      onClick={onClose}
                      className="inline-flex items-center gap-1 font-semibold text-accent-text no-underline hover:underline"
                    >
                      Открыть карточку{" "}
                      <RiExternalLinkLine size={12} aria-hidden />
                    </Link>
                  ) : (
                    <span className="text-faint">не связана</span>
                  )}
                </Prop>
                <Prop label="В мониторинге с">
                  {row.monitoredSince
                    ? formatShortDate(row.monitoredSince)
                    : null}
                </Prop>

                <SectionLabel>Конфигурации</SectionLabel>
                <Prop label="Экспорт">
                  {exportSchedule || (
                    <span className="text-faint">по расписанию выключен</span>
                  )}
                </Prop>
                <Prop label="Последняя копия">
                  {row.lastExportAt ? formatDate(row.lastExportAt) : null}
                </Prop>
              </div>

              <div className="flex gap-2 border-t border-border-soft px-5 py-3.5">
                <Button asChild className="flex-1">
                  <Link
                    to={`/devices/mikrotik/records/${row.recordId}`}
                    onClick={onClose}
                  >
                    Открыть устройство <RiArrowRightSLine />
                  </Link>
                </Button>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Ещё действия"
                      >
                        <RiMoreLine />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          offcanvas.setShow();
                          onClose();
                          navigate(`/devices/mikrotik/update/${row.recordId}`);
                        }}
                      >
                        <RiEdit2Line /> Изменить
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={isBusy}
                        onClick={toggleMonitoring}
                      >
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
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Вне radix-меню: меню размонтирует содержимое при закрытии */}
      {row && (
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
      )}
    </>
  );
};

export default DeviceSheet;

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

const dash = <span className="tw:text-faint">—</span>;

// Микро-метка секции шторки.
const SectionLabel = ({ children }) => (
  <div className="tw:mt-5 tw:mb-1.5 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
    {children}
  </div>
);

// Строка «подпись · значение» шторки (+ копирование с тостом).
const Prop = ({ label, mono, copy, children }) => (
  <div className="tw:flex tw:items-start tw:gap-3 tw:border-t tw:border-border-soft tw:py-2 tw:first:border-t-0">
    <div className="tw:w-36 tw:flex-none tw:pt-px tw:text-sm tw:text-muted-foreground">
      {label}
    </div>
    <div
      className={cn(
        "tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1.5 tw:text-sm",
        mono && "tw:font-mono",
      )}
    >
      <span className="tw:min-w-0 tw:truncate">{children ?? dash}</span>
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
          className="tw:grid tw:size-6 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-faint tw:transition-colors tw:hover:bg-accent tw:hover:text-muted-foreground"
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
        <SheetContent side="right" className="tw:w-11/12 tw:max-w-md">
          {row && (
            <>
              <div className="tw:flex tw:items-center tw:gap-3 tw:px-5 tw:pt-4 tw:pr-10">
                <DeviceTile row={row} />
                <div className="tw:min-w-0">
                  <SheetTitle className="tw:my-0 tw:truncate tw:text-lg tw:leading-snug tw:font-semibold tw:tracking-tight">
                    {row.displayName}
                  </SheetTitle>
                  <div className="tw:truncate tw:text-sm tw:text-muted-foreground">
                    {[row.type, row.company?.name].filter(Boolean).join(" · ") ||
                      "Устройство Mikrotik"}
                  </div>
                </div>
              </div>

              <div className="tw:flex-1 tw:overflow-y-auto tw:px-5 tw:pb-4">
                {/* Статус: слово с точкой + длительность; детали — приглушённо */}
                <div
                  className={cn(
                    "tw:mt-3.5 tw:flex tw:items-center tw:gap-2 tw:font-semibold",
                    statusMeta.text,
                  )}
                >
                  <span
                    className={cn(
                      "tw:size-2 tw:rounded-full",
                      statusMeta.dot,
                      status === "online" && "tw:ring-3 tw:ring-primary/20",
                    )}
                  />
                  {statusMeta.label}
                  {status === "offline" && row.offlineSince && (
                    <span className="tw:font-semibold">
                      ·{" "}
                      {formatDurationShort(
                        Date.now() - new Date(row.offlineSince).getTime(),
                      )}
                    </span>
                  )}
                </div>
                <div className="tw:mt-0.5 tw:ps-4 tw:text-sm tw:text-muted-foreground">
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
                  <div className="tw:mt-0.5 tw:ps-4 tw:font-mono tw:text-xs tw:text-faint">
                    {row.lastError}
                  </div>
                )}
                {status === "offline" && row.alertTicket && (
                  <Link
                    to={`/tickets/${row.alertTicket.num}`}
                    onClick={onClose}
                    className="tw:mt-2.5 tw:flex tw:items-center tw:gap-2.5 tw:rounded-lg tw:border tw:border-border-soft tw:bg-accent/40 tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:bg-accent"
                  >
                    <RiPulseLine
                      size={15}
                      aria-hidden
                      className="tw:flex-none"
                    />
                    <span className="tw:min-w-0 tw:truncate">
                      Заявка{" "}
                      <b className="tw:font-semibold tw:text-accent-text">
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
                      className="tw:ms-auto tw:flex-none tw:text-faint"
                    />
                  </Link>
                )}

                <SectionLabel>Прошивка и безопасность</SectionLabel>
                <div className="tw:text-sm">
                  <span className="tw:font-mono tw:font-semibold">
                    RouterOS{" "}
                    {firmware?.installedVersion || row.currentFirmware || "—"}
                  </span>
                  {firmware?.channel && (
                    <span className="tw:text-faint">
                      {" "}
                      · ветка {firmware.channel}
                    </span>
                  )}
                </div>
                {firmware?.vulnerable ? (
                  <>
                    <div className="tw:mt-1 tw:flex tw:items-center tw:gap-1.5 tw:text-sm tw:font-semibold tw:text-warning">
                      <RiShieldFlashLine size={14} aria-hidden />
                      {firmware.cves.length === 1
                        ? "1 уязвимость"
                        : `Уязвимости: ${firmware.cves.length}`}{" "}
                      · исправлены в {firmware.latestVersion}
                    </div>
                    <div className="tw:mt-1">
                      {firmware.cves.slice(0, 3).map((cve) => (
                        <div
                          key={cve.id}
                          className="tw:flex tw:items-baseline tw:gap-2 tw:border-t tw:border-border-soft tw:py-1.5 tw:text-sm tw:first:border-t-0"
                        >
                          <span className="tw:font-mono">{cve.id}</span>
                          <span
                            className={cn(
                              "tw:flex-none tw:font-semibold tw:whitespace-nowrap",
                              cve.score >= 9
                                ? "tw:text-destructive"
                                : "tw:text-warning",
                            )}
                          >
                            {cve.score} {cve.severity?.toLowerCase()}
                          </span>
                          <span className="tw:min-w-0 tw:truncate tw:text-xs tw:text-faint">
                            {cve.description}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : firmware?.updateAvailable ? (
                  <div className="tw:mt-1 tw:text-sm tw:text-muted-foreground">
                    Доступно обновление до{" "}
                    <span className="tw:font-mono tw:font-semibold tw:text-foreground">
                      {firmware.latestVersion}
                    </span>
                  </div>
                ) : firmware ? (
                  <div className="tw:mt-1 tw:text-sm tw:text-faint">
                    Актуальная версия ветки.
                  </div>
                ) : null}

                <SectionLabel>Доступность · 30 дней</SectionLabel>
                <UptimeBar
                  segments={daySegments(row.uptimeDays, {
                    ongoing: status === "offline",
                  })}
                />
                <div className="tw:mt-1.5 tw:text-sm">
                  <span
                    className={cn(
                      "tw:tabular-nums",
                      uptimeToneClass(row.uptime30d),
                    )}
                  >
                    {formatUptime(row.uptime30d) || "—"}
                  </span>
                  <span className="tw:text-faint">
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
                      className="tw:inline-flex tw:items-center tw:gap-1 tw:font-semibold tw:text-accent-text tw:no-underline tw:hover:underline"
                    >
                      Открыть карточку{" "}
                      <RiExternalLinkLine size={12} aria-hidden />
                    </Link>
                  ) : (
                    <span className="tw:text-faint">не связана</span>
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
                    <span className="tw:text-faint">по расписанию выключен</span>
                  )}
                </Prop>
                <Prop label="Последняя копия">
                  {row.lastExportAt ? formatDate(row.lastExportAt) : null}
                </Prop>
              </div>

              <div className="tw:flex tw:gap-2 tw:border-t tw:border-border-soft tw:px-5 tw:py-3.5">
                <Button asChild className="tw:flex-1">
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

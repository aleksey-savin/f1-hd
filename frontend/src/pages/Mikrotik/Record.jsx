import { useEffect, useState } from "react";
import {
  Link,
  Outlet,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";

import {
  RiArchive2Line,
  RiArrowLeftSLine,
  RiBarcodeLine,
  RiCalendar2Line,
  RiCpuLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiExternalLinkLine,
  RiGlobalLine,
  RiLinksLine,
  RiMapPin2Line,
  RiMoreLine,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiPulseLine,
  RiShieldFlashLine,
  RiTerminalBoxLine,
  RiUserLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Panel, Eyebrow } from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
import FormSheet from "@/components/app/FormSheet";
import { cn } from "@/lib/utils";
import useOffcanvasStore from "@/store/offcanvas";
import useToastStore from "@/store/toast-store";

import ConfirmDialog from "../../components/Mikrotik/ConfirmDialog";
import AvailabilitySection from "../../components/Mikrotik/AvailabilitySection";
import ConfigsSection from "../../components/Mikrotik/ConfigsSection";
import {
  DeviceTile,
  STATUS_META,
  formatAgo,
  formatDurationShort,
} from "../../components/Mikrotik/meta";
import usePolling from "../../hooks/use-polling";
import useMikrotikDeviceFilterStore, {
  rowStatus,
} from "../../store/lists/mikrotik-devices";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import { useCan } from "@/store/authed-user";

const dash = <span className="text-faint">—</span>;

// Страница записи мониторинга — общая для инвентарных и standalone устройств:
// hero со статусом и охватом, секции «Подключение» / «Прошивка и безопасность»
// / «Доступность» / «Сеть» / «Конфигурации». Правка — в шторке на месте
// (вложенный маршрут update), статус обновляется тихой ревалидацией.
const MikrotikRecordPage = () => {
  const row = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const offcanvas = useOffcanvasStore();
  const showToast = useToastStore((state) => state.showToast);
  const can = useCan();
  const canManage = can({ mikrotik: ["manageDevices"] });
  const canManageConfigs = can({ mikrotik: ["manageConfigs"] });

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

  // Карточка, открытая из проскроленного списка, без сброса уезжает под бар.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Тихое обновление статуса/прошивки (реже, чем список: страница живёт на
  // loader-данных). Ревалидация не трогает локальный стейт секций.
  usePolling(() => revalidator.revalidate(), { intervalMs: 30000 });

  const status = rowStatus(row);
  const statusMeta = STATUS_META[status] || STATUS_META.offline;
  const firmware = row.firmwareStatus;
  const activeAddresses = (row.addresses || []).filter(
    (address) => address.disabled === "false",
  );
  const record = row.record || {};

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
      if (response.ok) revalidator.revalidate();
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
      if (!response.ok) {
        showToast("danger", data.message || "Не удалось удалить устройство");
        return;
      }
      showToast("success", data.message || "Устройство удалено из мониторинга");
      navigate("/devices/mikrotik");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        to="/devices/mikrotik"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
      >
        <RiArrowLeftSLine /> Мониторинг Mikrotik
      </Link>

      {/* ── Hero ── */}
      <div className="flex flex-wrap items-center gap-4">
        <DeviceTile row={row} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="my-0 truncate text-3xl font-semibold tracking-tight">
            {row.displayName}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-semibold",
                statusMeta.text,
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  statusMeta.dot,
                  status === "online" && "ring-4 ring-primary/20",
                )}
              />
              {statusMeta.label}
              {status === "offline" && row.offlineSince && (
                <>
                  {" "}
                  ·{" "}
                  {formatDurationShort(
                    Date.now() - new Date(row.offlineSince).getTime(),
                  )}
                </>
              )}
            </span>
            <span className="text-muted-foreground">
              {[row.type, row.company?.name, row.location?.name]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {row.uptime30d != null && (
                <>
                  {row.uptime30d.toLocaleString("ru-RU", {
                    maximumFractionDigits: 2,
                  })}
                  % за 30 дней ·{" "}
                </>
              )}
              {activeAddresses.length}{" "}
              {plural(activeAddresses.length, "адрес", "адреса", "адресов")}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Ещё действия">
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
            <Button asChild>
              <Link to="update" onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Статусные детали: ошибка и заявка эпизода */}
      {status === "offline" && (row.lastError || row.alertTicket) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {row.lastError && (
            <span className="font-mono text-xs text-faint">
              {row.lastError}
            </span>
          )}
          {row.alertTicket && (
            <Link
              to={`/tickets/${row.alertTicket.num}`}
              className="inline-flex items-center gap-1.5 font-medium text-accent-text no-underline hover:underline"
            >
              <RiPulseLine size={14} aria-hidden />
              Заявка №{row.alertTicket.num} о недоступности
            </Link>
          )}
        </div>
      )}

      {/* ── Подключение ── */}
      <Eyebrow id="connection">Подключение</Eyebrow>
      <Panel>
        <div className="grid gap-x-8 md:grid-cols-2">
          <div>
            <PropRow
              icon={<RiGlobalLine size={17} />}
              label="Хост · порт API-SSL"
              copy={row.host ? { value: row.host, label: "Хост" } : undefined}
            >
              <span className="font-mono text-sm">
                {row.host
                  ? `${row.host}${row.port ? `:${row.port}` : ""}`
                  : dash}
              </span>
            </PropRow>
            <PropRow icon={<RiTerminalBoxLine size={17} />} label="SSH-порт">
              <span className="font-mono text-sm">
                {record.credentials?.sshPort ?? 22}
              </span>
            </PropRow>
            <PropRow icon={<RiUserLine size={17} />} label="Пользователь">
              <span className="font-mono text-sm">
                {record.credentials?.user || dash}
              </span>
            </PropRow>
            <PropRow icon={<RiLinksLine size={17} />} label="Подключение">
              {row.jump
                ? `через ${row.jump.name || "устройство"} (SSH-туннель)`
                : "напрямую, API-SSL"}
            </PropRow>
          </div>
          <div>
            <PropRow icon={<RiCpuLine size={17} />} label="Модель · плата">
              {row.model?.name || row.boardName ? (
                <>
                  {row.model?.name || row.boardName}
                  {row.model?.name &&
                    row.boardName &&
                    row.model.name !== row.boardName && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {row.boardName}
                      </span>
                    )}
                </>
              ) : (
                dash
              )}
            </PropRow>
            <PropRow
              icon={<RiBarcodeLine size={17} />}
              label="Серийный номер"
              copy={
                row.serialNumber
                  ? { value: row.serialNumber, label: "Серийный номер" }
                  : undefined
              }
            >
              <span className="font-mono text-sm">
                {row.serialNumber || dash}
              </span>
            </PropRow>
            {row.location && (
              <PropRow icon={<RiMapPin2Line size={17} />} label="Расположение">
                {row.location.name}
              </PropRow>
            )}
            <PropRow
              icon={<RiArchive2Line size={17} />}
              label="Карточка инвентаря"
            >
              {row.clientDeviceId ? (
                <Link
                  to={`/inventory/client-devices/${row.clientDeviceId}`}
                  className="inline-flex items-center gap-1 font-semibold text-accent-text no-underline hover:underline"
                >
                  {row.inventory?.modelName || row.model?.name || "Открыть"}
                  {row.inventory?.inventoryNumber &&
                    ` · №${row.inventory.inventoryNumber}`}{" "}
                  <RiExternalLinkLine size={12} aria-hidden />
                </Link>
              ) : (
                <span className="text-muted-foreground">не связана</span>
              )}
            </PropRow>
            <PropRow
              icon={<RiCalendar2Line size={17} />}
              label="В мониторинге с"
            >
              {row.monitoredSince ? formatShortDate(row.monitoredSince) : dash}
            </PropRow>
          </div>
        </div>
        {status !== "disabled" && row.lastCheckedAt && (
          <div className="mt-3 border-t border-border-soft pt-2.5 text-xs text-faint">
            Проверка каждые 5 минут · последняя — {formatAgo(row.lastCheckedAt)}
          </div>
        )}
      </Panel>

      {/* ── Прошивка и безопасность ── */}
      <Eyebrow id="firmware">Прошивка и безопасность</Eyebrow>
      <Panel>
        <div className="text-base">
          <span className="font-mono font-semibold">
            RouterOS {firmware?.installedVersion || row.currentFirmware || "—"}
          </span>
          {firmware?.channel && (
            <span className="text-faint"> · ветка {firmware.channel}</span>
          )}
        </div>
        {firmware?.vulnerable ? (
          <>
            <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-warning">
              <RiShieldFlashLine size={15} aria-hidden />
              {firmware.cves.length === 1
                ? "1 уязвимость"
                : `Уязвимости: ${firmware.cves.length}`}{" "}
              · исправлены в {firmware.latestVersion}
            </div>
            <div className="mt-1.5">
              {firmware.cves.map((cve) => (
                <div
                  key={cve.id}
                  className="flex items-baseline gap-2.5 border-t border-border-soft py-1.5 text-sm first:border-t-0"
                >
                  <span className="flex-none font-mono">{cve.id}</span>
                  <span
                    className={cn(
                      "flex-none font-semibold whitespace-nowrap",
                      cve.score >= 9 ? "text-destructive" : "text-warning",
                    )}
                  >
                    {cve.score} {cve.severity?.toLowerCase()}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {cve.description}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : firmware?.updateAvailable ? (
          <div className="mt-1.5 text-sm text-muted-foreground">
            Доступно обновление до{" "}
            <span className="font-mono font-semibold text-foreground">
              {firmware.latestVersion}
            </span>{" "}
            ·{" "}
            <a
              href="https://mikrotik.com/download/changelogs"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent-text no-underline hover:underline"
            >
              чейнджлог
            </a>
          </div>
        ) : firmware ? (
          <div className="mt-1.5 text-sm text-faint">
            Актуальная версия ветки. Известных уязвимостей ≥ порога из настроек
            нет.
          </div>
        ) : (
          <div className="mt-1.5 text-sm text-faint">
            Версия прошивки ещё не считана.
          </div>
        )}
      </Panel>

      {/* ── Доступность ── */}
      <AvailabilitySection recordId={row.recordId} />

      {/* ── Сеть ── */}
      <Eyebrow id="network" count={activeAddresses.length}>
        Сеть
      </Eyebrow>
      <Panel>
        {activeAddresses.length === 0 ? (
          <div className="text-sm text-faint">Активных адресов не считано.</div>
        ) : (
          <>
            <div className="flex gap-3.5 border-b border-border-soft pb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">
              <span className="w-44 flex-none">Адрес</span>
              <span className="hidden w-36 flex-none md:block">Сеть</span>
              <span className="w-32 flex-none">Интерфейс</span>
              <span className="flex-1">Комментарий</span>
            </div>
            {activeAddresses.map((address) => (
              <div
                key={address._id || address.address}
                className="flex items-baseline gap-3.5 border-b border-border-soft py-2 text-sm last:border-b-0"
              >
                <span className="w-44 flex-none font-mono">
                  {address.address}
                </span>
                <span className="hidden w-36 flex-none font-mono text-muted-foreground md:block">
                  {address.network}
                </span>
                <span className="w-32 flex-none truncate text-muted-foreground">
                  {address.interface}
                </span>
                <span className="min-w-0 flex-1 truncate text-faint">
                  {[
                    address.comment,
                    address.dynamic === "true" ? "динамический" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
              </div>
            ))}
          </>
        )}
      </Panel>

      {/* ── Конфигурации (по отдельному праву) ── */}
      {canManageConfigs && (
        <ConfigsSection
          recordId={row.recordId}
          initialSchedule={row.schedules?.export}
        />
      )}

      <div className="mt-6 border-t border-border-soft pt-3 text-xs text-faint">
        Данные снимаются с устройства при каждой проверке. Точность границ
        эпизодов — до 5 минут.
      </div>

      {/* Правка — шторка на месте (вложенный маршрут update) */}
      <FormSheet
        open={offcanvas.isActive}
        onOpenChange={(open) => {
          if (!open) {
            navigate(-1);
            offcanvas.setClose();
          }
        }}
      >
        <Outlet />
      </FormSheet>

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
    </div>
  );
};

export default MikrotikRecordPage;

export async function loader({ params }) {
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/records/${params.recordId}`,
  );

  if (!response.ok) throw response;

  const data = await response.json();
  document.title = `Просмотр ${data.displayName || "устройства Mikrotik"}`;
  return data;
}

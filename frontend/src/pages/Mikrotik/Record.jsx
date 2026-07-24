import { useContext, useEffect, useState } from "react";
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
import { AuthedUserContext } from "../../store/authed-user-context";
import useMikrotikDeviceFilterStore, {
  rowStatus,
} from "../../store/lists/mikrotik-devices";
import { getLocalStorageData } from "../../util/auth";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";

const dash = <span className="tw:text-faint">—</span>;

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
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageMikrotikDevices;
  const canManageConfigs = permissions.canManageMikrotikConfigs;

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
        showToast(
          "danger",
          data.message || "Не удалось удалить устройство",
        );
        return;
      }
      showToast("success", data.message || "Устройство удалено из мониторинга");
      navigate("/devices/mikrotik");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-5xl">
      <Link
        to="/devices/mikrotik"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Мониторинг Mikrotik
      </Link>

      {/* ── Hero ── */}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-4">
        <DeviceTile row={row} size="lg" />
        <div className="tw:min-w-0 tw:flex-1">
          <h1 className="tw:my-0 tw:truncate tw:text-3xl tw:font-semibold tw:tracking-tight">
            {row.displayName}
          </h1>
          <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-1 tw:text-sm">
            <span
              className={cn(
                "tw:inline-flex tw:items-center tw:gap-1.5 tw:font-semibold",
                statusMeta.text,
              )}
            >
              <span
                className={cn(
                  "tw:size-2 tw:rounded-full",
                  statusMeta.dot,
                  status === "online" && "tw:ring-4 tw:ring-primary/20",
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
            <span className="tw:text-muted-foreground">
              {[row.type, row.company?.name, row.location?.name]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="tw:text-muted-foreground tw:tabular-nums">
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
          <div className="tw:flex tw:gap-2">
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
        <div className="tw:mt-3 tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1 tw:text-sm tw:text-muted-foreground">
          {row.lastError && (
            <span className="tw:font-mono tw:text-xs tw:text-faint">
              {row.lastError}
            </span>
          )}
          {row.alertTicket && (
            <Link
              to={`/tickets/${row.alertTicket.num}`}
              className="tw:inline-flex tw:items-center tw:gap-1.5 tw:font-medium tw:text-accent-text tw:no-underline tw:hover:underline"
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
        <div className="tw:grid tw:gap-x-8 tw:md:grid-cols-2">
          <div>
            <PropRow
              icon={<RiGlobalLine size={17} />}
              label="Хост · порт API-SSL"
              copy={row.host ? { value: row.host, label: "Хост" } : undefined}
            >
              <span className="tw:font-mono tw:text-sm">
                {row.host ? `${row.host}${row.port ? `:${row.port}` : ""}` : dash}
              </span>
            </PropRow>
            <PropRow icon={<RiTerminalBoxLine size={17} />} label="SSH-порт">
              <span className="tw:font-mono tw:text-sm">
                {record.credentials?.sshPort ?? 22}
              </span>
            </PropRow>
            <PropRow icon={<RiUserLine size={17} />} label="Пользователь">
              <span className="tw:font-mono tw:text-sm">
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
                      <span className="tw:text-muted-foreground">
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
              <span className="tw:font-mono tw:text-sm">
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
                  className="tw:inline-flex tw:items-center tw:gap-1 tw:font-semibold tw:text-accent-text tw:no-underline tw:hover:underline"
                >
                  {row.inventory?.modelName || row.model?.name || "Открыть"}
                  {row.inventory?.inventoryNumber &&
                    ` · №${row.inventory.inventoryNumber}`}{" "}
                  <RiExternalLinkLine size={12} aria-hidden />
                </Link>
              ) : (
                <span className="tw:text-muted-foreground">не связана</span>
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
          <div className="tw:mt-3 tw:border-t tw:border-border-soft tw:pt-2.5 tw:text-xs tw:text-faint">
            Проверка каждые 5 минут · последняя — {formatAgo(row.lastCheckedAt)}
          </div>
        )}
      </Panel>

      {/* ── Прошивка и безопасность ── */}
      <Eyebrow id="firmware">Прошивка и безопасность</Eyebrow>
      <Panel>
        <div className="tw:text-base">
          <span className="tw:font-mono tw:font-semibold">
            RouterOS {firmware?.installedVersion || row.currentFirmware || "—"}
          </span>
          {firmware?.channel && (
            <span className="tw:text-faint"> · ветка {firmware.channel}</span>
          )}
        </div>
        {firmware?.vulnerable ? (
          <>
            <div className="tw:mt-1.5 tw:flex tw:items-center tw:gap-1.5 tw:text-sm tw:font-semibold tw:text-warning">
              <RiShieldFlashLine size={15} aria-hidden />
              {firmware.cves.length === 1
                ? "1 уязвимость"
                : `Уязвимости: ${firmware.cves.length}`}{" "}
              · исправлены в {firmware.latestVersion}
            </div>
            <div className="tw:mt-1.5">
              {firmware.cves.map((cve) => (
                <div
                  key={cve.id}
                  className="tw:flex tw:items-baseline tw:gap-2.5 tw:border-t tw:border-border-soft tw:py-1.5 tw:text-sm tw:first:border-t-0"
                >
                  <span className="tw:flex-none tw:font-mono">{cve.id}</span>
                  <span
                    className={cn(
                      "tw:flex-none tw:font-semibold tw:whitespace-nowrap",
                      cve.score >= 9 ? "tw:text-destructive" : "tw:text-warning",
                    )}
                  >
                    {cve.score} {cve.severity?.toLowerCase()}
                  </span>
                  <span className="tw:min-w-0 tw:truncate tw:text-muted-foreground">
                    {cve.description}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : firmware?.updateAvailable ? (
          <div className="tw:mt-1.5 tw:text-sm tw:text-muted-foreground">
            Доступно обновление до{" "}
            <span className="tw:font-mono tw:font-semibold tw:text-foreground">
              {firmware.latestVersion}
            </span>{" "}
            ·{" "}
            <a
              href="https://mikrotik.com/download/changelogs"
              target="_blank"
              rel="noreferrer"
              className="tw:font-medium tw:text-accent-text tw:no-underline tw:hover:underline"
            >
              чейнджлог
            </a>
          </div>
        ) : firmware ? (
          <div className="tw:mt-1.5 tw:text-sm tw:text-faint">
            Актуальная версия ветки. Известных уязвимостей ≥ порога из настроек
            нет.
          </div>
        ) : (
          <div className="tw:mt-1.5 tw:text-sm tw:text-faint">
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
          <div className="tw:text-sm tw:text-faint">
            Активных адресов не считано.
          </div>
        ) : (
          <>
            <div className="tw:flex tw:gap-3.5 tw:border-b tw:border-border-soft tw:pb-1.5 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-faint tw:uppercase">
              <span className="tw:w-44 tw:flex-none">Адрес</span>
              <span className="tw:hidden tw:w-36 tw:flex-none tw:md:block">
                Сеть
              </span>
              <span className="tw:w-32 tw:flex-none">Интерфейс</span>
              <span className="tw:flex-1">Комментарий</span>
            </div>
            {activeAddresses.map((address) => (
              <div
                key={address._id || address.address}
                className="tw:flex tw:items-baseline tw:gap-3.5 tw:border-b tw:border-border-soft tw:py-2 tw:text-sm tw:last:border-b-0"
              >
                <span className="tw:w-44 tw:flex-none tw:font-mono">
                  {address.address}
                </span>
                <span className="tw:hidden tw:w-36 tw:flex-none tw:font-mono tw:text-muted-foreground tw:md:block">
                  {address.network}
                </span>
                <span className="tw:w-32 tw:flex-none tw:truncate tw:text-muted-foreground">
                  {address.interface}
                </span>
                <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-faint">
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

      <div className="tw:mt-6 tw:border-t tw:border-border-soft tw:pt-3 tw:text-xs tw:text-faint">
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
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/records/${params.recordId}`,
    { headers: { Authorization: "Bearer " + token } },
  );

  if (!response.ok) throw response;

  const data = await response.json();
  document.title = `Просмотр ${data.displayName || "устройства Mikrotik"}`;
  return data;
}

import { useEffect, useState } from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { BrowserView } from "react-device-detect";

import {
  RiArchive2Line,
  RiArrowRightSLine,
  RiBarcodeLine,
  RiCalendar2Line,
  RiCpuLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiGlobalLine,
  RiLinksLine,
  RiMoreLine,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiPulseLine,
  RiShieldFlashLine,
  RiTerminalBoxLine,
  RiTimeLine,
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
import AnchorRail from "@/components/app/AnchorRail";
import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import { Panel, Eyebrow } from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
import FormOutlet from "@/components/app/FormOutlet";
import { cn } from "@/lib/utils";
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
import useLiveRouteRevalidate from "@/hooks/use-live-route-revalidate";
import useMikrotikDeviceFilterStore, {
  rowStatus,
} from "../../store/lists/mikrotik-devices";
import { formatDate, formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import { useCan } from "@/store/authed-user";

const dash = <span className="text-faint">—</span>;

const pillClass =
  "mt-2.5 inline-flex max-w-full items-center gap-2 rounded-lg bg-accent px-2.5 py-1.5 text-sm text-muted-foreground no-underline";

/**
 * Строка hero «карточка инвентаря»: у записи есть карточка — одна ссылка на
 * неё с тем, что карточка знает сама (модель · инв. номер · расположение), без
 * повтора этих фактов ниже; карточки нет — то же предложение, что у шага после
 * проверки в форме: связать найденную по серийнику или создать из считанных
 * данных. `inventory === null` — модуль «Учёт техники» выключен, строки нет.
 */
const InventoryLine = ({ row, canManage, onChanged }) => {
  const showToast = useToastStore((state) => state.showToast);
  const linkInventory = useMikrotikDeviceFilterStore(
    (state) => state.linkInventory,
  );
  const createInventoryCard = useMikrotikDeviceFilterStore(
    (state) => state.createInventoryCard,
  );
  const [busy, setBusy] = useState(false);
  // Ссылка в чужой раздел несёт «откуда пришли» — крошка карточки вернёт сюда
  const fromState = useCrumbFrom(row.displayName);

  const inventory = row.inventory;

  if (row.clientDeviceId) {
    const facts = [
      inventory?.modelName,
      inventory?.inventoryNumber ? `инв. ${inventory.inventoryNumber}` : null,
      row.location?.name,
    ].filter(Boolean);
    return (
      <Link
        to={`/inventory/client-devices/${row.clientDeviceId}`}
        state={fromState}
        className={cn(pillClass, "hover:text-foreground")}
      >
        <RiArchive2Line size={15} aria-hidden className="flex-none" />
        <span className="min-w-0 truncate">
          Карточка инвентаря:{" "}
          <span className="font-medium text-accent-text">
            {facts.join(" · ") || "открыть"}
          </span>
        </span>
        <RiArrowRightSLine size={15} aria-hidden className="flex-none" />
      </Link>
    );
  }

  if (!inventory) return null;

  const candidate = inventory.candidate;

  const run = async (request, okMessage, failMessage) => {
    setBusy(true);
    try {
      const response = await request();
      const data = await response.json().catch(() => ({}));
      showToast(
        response.ok ? "success" : "danger",
        data.message || (response.ok ? okMessage : failMessage),
      );
      if (response.ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  const actionClass =
    "cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold text-accent-text hover:underline disabled:cursor-default disabled:opacity-60";

  return (
    <span className={cn(pillClass, "flex-wrap")}>
      <RiArchive2Line size={15} aria-hidden className="flex-none" />
      {candidate ? (
        <span className="min-w-0">
          Найдена карточка с этим серийным номером:{" "}
          <span className="font-medium text-foreground">
            {[
              [candidate.vendorName, candidate.modelName]
                .filter(Boolean)
                .join(" ") || candidate.hostname,
              candidate.inventoryNumber
                ? `инв. ${candidate.inventoryNumber}`
                : null,
              candidate.company?.name,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      ) : (
        <span>Карточки в инвентаре нет</span>
      )}
      {canManage && candidate && (
        <>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <button
            type="button"
            disabled={busy}
            className={actionClass}
            onClick={() =>
              run(
                () => linkInventory(row.recordId, candidate.clientDeviceId),
                "Карточка связана",
                "Не удалось связать карточку",
              )
            }
          >
            {busy ? "Связываем…" : "Связать"}
          </button>
        </>
      )}
      {canManage && !candidate && inventory.canCreateCard && (
        <>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <button
            type="button"
            disabled={busy}
            className={actionClass}
            onClick={() =>
              run(
                () => createInventoryCard(row.recordId),
                "Карточка создана и связана",
                "Не удалось создать карточку",
              )
            }
          >
            {busy ? "Создаём…" : "Создать карточку"}
          </button>
        </>
      )}
    </span>
  );
};

/**
 * Страница записи мониторинга — общая для инвентарных и standalone устройств.
 * У страницы одна тема — операции: связь, проверки, прошивка, доступность,
 * сеть, копии конфигураций. Идентичность устройства (модель, серийник,
 * расположение, инв. номер) принадлежит карточке инвентаря и здесь свёрнута в
 * одну строку-ссылку под заголовком; у записи без карточки плата и серийник
 * остаются — с пометкой «с устройства», хозяина у них нет.
 *
 * Разметка — канон карточки (hero → секции → действия, `docs/ux-ui-guide.md`):
 * крошки, hero с плиткой раздела и одной залитой «Изменить», секции-панели с
 * eyebrow-метками, слева липкий рейл-якорь. Правка параметров — в шторке на
 * месте (вложенный маршрут `update`), расписание экспорта — своя шторка
 * (`schedule`, см. ScheduleForm); статус обновляется тихой ревалидацией.
 */
const MikrotikRecordPage = () => {
  const row = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const showToast = useToastStore((state) => state.showToast);
  const can = useCan();
  const canManage = can({ mikrotik: ["manage"] });
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

  // Тихое обновление статуса/прошивки по пульсу (docs/live-updates.md); раз в
  // 5 минут — в любом случае, «время проверки» течёт и без событий.
  // Ревалидация не трогает локальный стейт секций.
  useLiveRouteRevalidate("mikrotik", {
    baseline: row.pulse,
    maxStaleMs: 5 * 60_000,
  });

  const status = rowStatus(row);
  const statusMeta = STATUS_META[status] || STATUS_META.offline;
  const firmware = row.firmwareStatus;
  const activeAddresses = (row.addresses || []).filter(
    (address) => address.disabled === "false",
  );
  const record = row.record || {};
  const linked = Boolean(row.clientDeviceId);

  // Рейл собирается только из реально отрисованных секций.
  const railSections = [
    { id: "connection", label: "Подключение" },
    { id: "firmware", label: "Прошивка и безопасность" },
    { id: "availability", label: "Доступность" },
    { id: "network", label: "Сеть" },
    canManageConfigs ? { id: "configs", label: "Конфигурации" } : null,
  ].filter(Boolean);

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
      <Crumbs />

      {/* ── Hero ── */}
      <div className="flex flex-wrap items-start gap-4">
        <DeviceTile row={row} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight">
            {row.displayName}
          </h1>
          {/* Вид и компания — у связанной записи их знает карточка,
              расположение живёт в строке карточки ниже */}
          <div className="mt-2 text-sm text-muted-foreground">
            {[row.type, row.company?.name].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
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
            {row.uptime30d != null && (
              <span className="text-muted-foreground tabular-nums">
                {row.uptime30d.toLocaleString("ru-RU", {
                  maximumFractionDigits: 2,
                })}
                % за 30 дней
              </span>
            )}
            <span className="text-muted-foreground tabular-nums">
              {activeAddresses.length}{" "}
              {plural(activeAddresses.length, "адрес", "адреса", "адресов")}
            </span>
          </div>
          <InventoryLine
            row={row}
            canManage={canManage}
            onChanged={() => revalidator.revalidate()}
          />
        </div>
        {canManage && (
          <div className="flex flex-none items-center gap-2">
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
              <Link to="update">
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
              Заявка {row.alertTicket.num} о недоступности
            </Link>
          )}
        </div>
      )}

      {/* Секции одним скроллом; слева — липкий рейл-якорь (только десктоп) */}
      <div className="flex items-start gap-7">
        <BrowserView className="contents">
          <AnchorRail
            sections={railSections}
            ariaLabel="Разделы записи"
            className="mt-6"
          />
        </BrowserView>
        <div className="min-w-0 flex-1">
          {/* ── Подключение: слева доступ, справа проверки ── */}
          <Eyebrow id="connection">Подключение</Eyebrow>
          <Panel>
            <div className="grid gap-x-8 md:grid-cols-2">
              <div>
                <PropRow
                  icon={<RiGlobalLine size={17} />}
                  label="Хост · порт API-SSL"
                  copy={
                    row.host ? { value: row.host, label: "Хост" } : undefined
                  }
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
                <PropRow
                  icon={<RiCalendar2Line size={17} />}
                  label="В мониторинге с"
                >
                  {row.monitoredSince
                    ? formatShortDate(row.monitoredSince)
                    : dash}
                </PropRow>
                <PropRow icon={<RiTimeLine size={17} />} label="Проверка">
                  {status === "disabled" ? (
                    <span className="text-muted-foreground">
                      остановлена — мониторинг выключен
                    </span>
                  ) : (
                    <>
                      каждые 5 минут
                      {row.lastCheckedAt && (
                        <span className="text-muted-foreground">
                          {" "}
                          · последняя — {formatAgo(row.lastCheckedAt)}
                        </span>
                      )}
                    </>
                  )}
                </PropRow>
                <PropRow icon={<RiPulseLine size={17} />} label="Последняя связь">
                  {row.lastSuccessfulConnectionAt
                    ? formatDate(row.lastSuccessfulConnectionAt)
                    : dash}
                </PropRow>
                {/* Без карточки у считанных с устройства плата и серийник нет
                    другого хозяина — показываем здесь, с пометкой источника */}
                {!linked && (
                  <>
                    <PropRow
                      icon={<RiCpuLine size={17} />}
                      label="Плата · с устройства"
                    >
                      <span className="font-mono text-sm">
                        {row.boardName || dash}
                      </span>
                    </PropRow>
                    <PropRow
                      icon={<RiBarcodeLine size={17} />}
                      label="Серийный номер · с устройства"
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
                  </>
                )}
              </div>
            </div>
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
                  changelog
                </a>
              </div>
            ) : firmware ? (
              <div className="mt-1.5 text-sm text-faint">
                Актуальная версия ветки. Известных уязвимостей ≥ порога из
                настроек нет.
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
              <div className="text-sm text-faint">
                Активных адресов не считано.
              </div>
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
              schedule={row.schedules?.export}
            />
          )}

          <div className="mt-6 border-t border-border-soft pt-3 text-xs text-faint">
            Данные снимаются с устройства при каждой проверке. Точность границ
            эпизодов — до 5 минут.
          </div>
        </div>
      </div>

      {/* Правка — шторка на месте (вложенные маршруты update / schedule) */}
      <FormOutlet />

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title={row.displayName}
        description={
          linked
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
  // Курсор живых обновлений на момент чтения записи (docs/live-updates.md)
  return { ...data, pulse: response.headers.get("X-Pulse-Cursor") };
}

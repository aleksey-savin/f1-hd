import { Fragment, useEffect, useRef, useState } from "react";
import {
  Link,
  useLoaderData,
  useLocation,
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
  RiErrorWarningLine,
  RiGlobalLine,
  RiLinksLine,
  RiMoreLine,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiPulseLine,
  RiTerminalBoxLine,
  RiTimeLine,
  RiUserLine,
  RiUserStarLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AnchorRail, { scrollToSection } from "@/components/app/AnchorRail";
import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import { Panel, Eyebrow } from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
import FormOutlet from "@/components/app/FormOutlet";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";

import ConfirmDialog from "../../components/Mikrotik/ConfirmDialog";
import FoldRow from "../../components/Mikrotik/FoldRow";
import ActivitySection from "../../components/Mikrotik/ActivitySection";
import AvailabilitySection from "../../components/Mikrotik/AvailabilitySection";
import JournalSection from "@/components/Mikrotik/JournalSection";
import ChangesSection from "../../components/Mikrotik/ChangesSection";
import ConfigsSection from "../../components/Mikrotik/ConfigsSection";
import FirmwareSection from "../../components/Mikrotik/FirmwareSection";
import {
  backupFlag,
  capitalize,
  licenseFlag,
} from "../../components/Mikrotik/health-flags.js";
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
import {
  formatDate,
  formatDayMonth,
  formatShortDate,
  formatTime,
} from "../../util/format-date";
import { plural } from "../../util/plural";
import { useCan } from "@/store/authed-user";

const dash = <span className="text-faint">—</span>;

// Сколько адресов секция «Сеть» показывает до «Показать все».
const ADDRESS_LIMIT = 6;

// Строки адресов: на телефоне — адрес и под ним «интерфейс · комментарий»,
// на десктопе — строка таблицы.
const addressRows = (addresses) =>
  addresses.map((address) => (
    <Fragment key={address._id || address.address}>
      <div className="border-t border-border-soft py-2 first:border-t-0 md:hidden">
        <div className="font-mono text-sm wrap-anywhere">{address.address}</div>
        <div className="text-xs text-faint">
          {[
            address.interface,
            address.comment,
            address.dynamic === "true" ? "динамический" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </div>
      <div className="flex items-baseline gap-3.5 border-b border-border-soft py-2 text-sm last:border-b-0 max-md:hidden">
        <span className="w-44 flex-none font-mono">{address.address}</span>
        <span className="hidden w-36 flex-none font-mono text-muted-foreground md:block">
          {address.network}
        </span>
        <span className="w-32 flex-none truncate text-muted-foreground">
          {address.interface}
        </span>
        <span className="min-w-0 flex-1 truncate text-faint">
          {[address.comment, address.dynamic === "true" ? "динамический" : null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </span>
      </div>
    </Fragment>
  ));

const pillClass =
  "mt-2.5 inline-flex max-w-full items-center gap-2 rounded-lg bg-accent px-2.5 py-1.5 text-sm text-muted-foreground no-underline max-md:flex max-md:w-full max-md:py-2";

/**
 * Ошибка связи и заявка текущего эпизода недоступности. Десктоп — строкой под
 * героем; телефон — подложкой внутри героя, под статусом: длинное сообщение
 * («connect ETIMEDOUT адрес:порт») переносится по символам, заявка — ниже.
 */
const EpisodeLine = ({ row, status, className }) => {
  if (status !== "offline" || (!row.lastError && !row.alertTicket)) {
    return null;
  }
  return (
    <div
      className={cn(
        "mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground",
        "max-md:flex-col max-md:items-start max-md:rounded-lg max-md:bg-destructive/10 max-md:px-2.5 max-md:py-2",
        className,
      )}
    >
      {row.lastError && (
        <span className="font-mono text-xs text-faint max-md:break-all max-md:text-foreground">
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
  );
};

/**
 * Флаг шапки (макет «Mikrotik: лицензия и копии», 09.10): проблема лицензии
 * или копий конфигурации янтарём в строке статуса, щелчок ведёт к секции, где
 * её чинят. Без `target` (секция скрыта правами) — тот же текст без перехода.
 */
const HeroFlag = ({ flag, text, target }) => {
  const className = "inline-flex items-center gap-1 font-semibold text-warning";
  const content = (
    <>
      <RiErrorWarningLine size={14} aria-hidden className="flex-none" />
      {text}
    </>
  );
  if (!target) {
    return (
      <span title={flag.title} className={className}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={flag.title}
      onClick={() => scrollToSection(null, target)}
      className={cn(
        className,
        "cursor-pointer appearance-none border-0 bg-transparent p-0 hover:underline",
      )}
    >
      {content}
    </button>
  );
};

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
        <span className="min-w-0 truncate max-md:flex-1">
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
  const location = useLocation();
  const revalidator = useRevalidator();
  const showToast = useToastStore((state) => state.showToast);
  const can = useCan();
  const canManage = can({ mikrotik: ["manage"] });
  const canReadChanges = can({ mikrotik: ["read"] });
  const canManageConfigs = can({ mikrotik: ["manageConfigs"] });
  const canUpgrade = can({ mikrotik: ["upgradeFirmware"] });

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
  const activeAddresses = (row.addresses || []).filter(
    (address) => address.disabled === "false",
  );
  const record = row.record || {};
  const linked = Boolean(row.clientDeviceId);
  const licenseProblem = licenseFlag(row.license, formatDayMonth);
  const backupProblem = backupFlag(row.backup);

  // Рейл собирается только из реально отрисованных секций.
  const railSections = [
    { id: "connection", label: "Подключение" },
    { id: "firmware", label: "Прошивка и безопасность" },
    { id: "availability", label: "Доступность" },
    { id: "activity", label: "Активность" },
    { id: "network", label: "Сеть" },
    canManageConfigs ? { id: "configs", label: "Конфигурации" } : null,
    canReadChanges ? { id: "changes", label: "Изменения" } : null,
    { id: "journal", label: "Журнал" },
  ].filter(Boolean);

  // Ссылка с якорем секции (`#configs` из страницы запроса) ведёт к ней, как
  // только секция появилась в рейле (состав рейла зависит от прав); один раз
  const hashDone = useRef(false);
  useEffect(() => {
    const target = location.hash.slice(1);
    if (hashDone.current || !target) return;
    if (scrollToSection(null, target, false)) hashDone.current = true;
  }, [railSections.length]);

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

      {/* ── Hero ──
          Сетка: на десктопе плитка слева на две строки, справа действия, в
          средней колонке имя и под ним детали. На телефоне (макет 28.09) рядом
          с плиткой только имя; детали и ряд действий («Изменить» во всю ширину
          + «⋯») — на всю ширину ниже. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <DeviceTile row={row} size="lg" className="md:row-span-2" />
        <div className="min-w-0">
          <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight wrap-anywhere">
            {row.displayName}
          </h1>
          {/* Вид и компания — у связанной записи их знает карточка,
              расположение живёт в строке карточки ниже */}
          <div className="mt-2 text-sm text-muted-foreground">
            {[row.type, row.company?.name].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2">
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm max-md:mt-3">
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
              {status === "planned" && (
                <> · до {formatTime(row.plannedOfflineUntil)}</>
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
            {/* Проблемы лицензии и копий; на телефоне — своей строкой */}
            {(licenseProblem || backupProblem) && (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 max-md:basis-full">
                {licenseProblem && (
                  <HeroFlag
                    flag={licenseProblem}
                    text={capitalize(licenseProblem.text)}
                    target="license"
                  />
                )}
                {backupProblem && (
                  <HeroFlag
                    flag={backupProblem}
                    text={backupProblem.heroText}
                    target={canManageConfigs ? "configs" : null}
                  />
                )}
              </span>
            )}
          </div>
          {/* Телефон: ошибка эпизода — сразу под статусом, до карточки */}
          <EpisodeLine row={row} status={status} className="md:hidden" />
          <InventoryLine
            row={row}
            canManage={canManage}
            onChanged={() => revalidator.revalidate()}
          />
        </div>
        {canManage && (
          <div className="col-span-2 mt-3 flex items-center gap-2 md:col-span-1 md:col-start-3 md:row-start-1 md:mt-0 md:flex-none">
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
            {/* На телефоне главное действие первым и во всю ширину */}
            <Button asChild className="max-md:order-first max-md:flex-1">
              <Link to="update">
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Статусные детали: ошибка и заявка эпизода (десктоп — под героем) */}
      <EpisodeLine row={row} status={status} className="max-md:hidden" />

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
                <PropRow
                  icon={<RiTerminalBoxLine size={17} />}
                  label="SSH-порт"
                >
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
                <PropRow
                  icon={<RiUserStarLine size={17} />}
                  label="Ответственный"
                >
                  {row.responsible ? (
                    <>
                      {row.responsible.name || "Сотрудник"}
                      {row.responsibleCanApprove === false && (
                        <span className="block text-sm text-warning">
                          У сотрудника больше нет права утверждать запросы
                          ИИ-агентов. Выберите другого ответственного.
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">не назначен</span>
                  )}
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
                <PropRow
                  icon={<RiPulseLine size={17} />}
                  label="Последняя связь"
                >
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

          {/* ── Прошивка и безопасность (версии, CVE, обновление из HD) ── */}
          <FirmwareSection
            row={row}
            canUpgrade={canUpgrade}
            canManage={canManage}
          />

          {/* ── Доступность ── */}
          <AvailabilitySection recordId={row.recordId} />
          <ActivitySection row={row} canManage={canManage} />

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
                {/* Телефон: вместо таблицы (колонки шире панели) — адрес и
                    под ним «интерфейс · комментарий» */}
                <div className="flex gap-3.5 border-b border-border-soft pb-1.5 text-xs font-semibold tracking-wide text-faint uppercase max-md:hidden">
                  <span className="w-44 flex-none">Адрес</span>
                  <span className="hidden w-36 flex-none md:block">Сеть</span>
                  <span className="w-32 flex-none">Интерфейс</span>
                  <span className="flex-1">Комментарий</span>
                </div>
                {/* Свой контейнер: first:/last: у строк считаются внутри него */}
                <div>
                  {addressRows(activeAddresses.slice(0, ADDRESS_LIMIT))}
                </div>
                {/* У нагруженных роутеров адресов десятки — хвост свёрнут */}
                {activeAddresses.length > ADDRESS_LIMIT && (
                  <FoldRow
                    flush
                    summary={`Ещё ${activeAddresses.length - ADDRESS_LIMIT} ${plural(
                      activeAddresses.length - ADDRESS_LIMIT,
                      "адрес",
                      "адреса",
                      "адресов",
                    )}`}
                    count={activeAddresses.length}
                  >
                    <div>
                      {addressRows(activeAddresses.slice(ADDRESS_LIMIT))}
                    </div>
                  </FoldRow>
                )}
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

          {/* ── Изменения: запросы ИИ-агентов по этому устройству ── */}
          {canReadChanges && (
            <ChangesSection
              recordId={row.recordId}
              deviceName={row.displayName}
            />
          )}

          {/* ── Журнал: общая лента событий устройства ── */}
          <JournalSection
            recordId={row.recordId}
            deviceName={row.displayName}
          />

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

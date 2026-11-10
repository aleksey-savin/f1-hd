import CancelOperationDialog, {
  canCancelOperation,
} from "./CancelOperationDialog";
import OperationStatus from "./OperationStatus";
import VmOperationDialog, {
  operationLabels,
  primaryPowerAction,
  powerDisabledReason,
} from "./VmOperationDialog";
import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import {
  RiServerLine,
  RiComputerLine,
  RiDatabase2Line,
  RiBuildingLine,
  RiMoreLine,
  RiPlayLine,
  RiShutDownLine,
  RiRestartLine,
  RiDownloadCloud2Line,
} from "react-icons/ri";
import AnchorRail from "@/components/app/AnchorRail";
import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import FormOutlet from "@/components/app/FormOutlet";
import FormSheet from "@/components/app/FormSheet";
import { FormActions } from "@/components/app/FormLayout";
import { SectionEditButton } from "@/components/app/Panel";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import Combobox from "@/components/app/Combobox";
import DateTimeField from "@/components/app/DateTimeField";
import SettingRow from "@/components/app/SettingRow";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { localToUtc, toDateTimeLocal } from "@/util/format-date";
import { useCan } from "@/store/authed-user";
import { ROOT, labels } from "./data";
import { Metrics, History } from "./Monitoring";
import Operations from "./Operations";
import GuestSecurity from "./GuestSecurity";
import {
  GuestAgentPanel,
  GuestAgentSheet,
  guestAgentState,
} from "./GuestAgent";
import AvailabilityPanel from "./AvailabilityPanel";
import NodeSecurity from "./NodeSecurity";
import ExposureSection, { ExposureLabel } from "./Exposure";
import {
  Status,
  Section,
  Properties,
  Field,
  TextField,
  Feedback,
  idOf,
  nameOf,
  optionsOf,
  bytes,
  date,
  useRefresh,
  titleOf,
  tlsNames,
  percent,
} from "./shared";
const actions = { ...operationLabels, archive: "Архивировать" };
const icons = {
  guests: RiComputerLine,
  nodes: RiServerLine,
  storages: RiDatabase2Line,
  connections: RiServerLine,
  companies: RiBuildingLine,
};
function Capacity({ item, kind }) {
  const r = item.resources || {};
  const cards =
    kind === "storages"
      ? [
          [
            "Объём хранилища",
            bytes(r.disk),
            r.diskUsed,
            r.disk,
            `${bytes(r.diskUsed)} занято`,
          ],
        ]
      : [
          [
            kind === "guests" ? "Выделено CPU" : "Процессоры",
            r.cpu != null
              ? `${r.cpu} ${kind === "guests" ? "vCPU" : "CPU"}`
              : "—",
            r.cpuUsage,
            1,
            r.cpuUsage != null
              ? `${percent(r.cpuUsage * 100)} используется`
              : "Нет данных о нагрузке",
          ],
          [
            kind === "guests" ? "Выделено RAM" : "Оперативная память",
            bytes(r.memory),
            r.memoryUsed,
            r.memory,
            `${bytes(r.memoryUsed)} используется`,
          ],
          [
            "Диски",
            bytes(r.disk),
            r.diskUsed,
            r.disk,
            `${bytes(r.diskUsed)} используется`,
          ],
        ];
  return (
    <div
      className={`grid gap-3 sm:gap-5 ${kind !== "storages" ? "grid-cols-3" : ""}`}
    >
      {cards.map(([label, value, used, total, hint]) => (
        <div key={label} className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-base font-semibold tabular-nums">
            {value}
          </div>
          <div
            className="my-3 h-1 overflow-hidden rounded-full bg-border"
            aria-hidden
          >
            <div
              className="h-full bg-primary"
              style={{
                width: `${used == null || !total ? 0 : Math.max(0, Math.min(100, (used / total) * 100))}%`,
              }}
            />
          </div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
      ))}
    </div>
  );
}
export default function ProxmoxDetail() {
  const { item, related = {}, kind, options = {} } = useLoaderData(),
    fetcher = useFetcher(),
    can = useCan();
  const [edit, setEdit] = useState(null),
    [value, setValue] = useState(""),
    [reason, setReason] = useState(""),
    [editError, setEditError] = useState("");
  const [activeOperation, setActiveOperation] = useState(undefined);
  const [operationStatusError, setOperationStatusError] = useState(null);
  const [cancelOperation, setCancelOperation] = useState(null);
  const [agentEditor, setAgentEditor] = useState(null);
  const [operation, setOperation] = useState(null),
    [storage, setStorage] = useState(""),
    [operationKey, setOperationKey] = useState("");
  const [overruleShutdown, setOverruleShutdown] = useState(false),
    [operationSubmitted, setOperationSubmitted] = useState(false);
  const id = idOf(item),
    resource = ["nodes", "guests", "storages"].includes(kind),
    manageable = can({ proxmox: ["manage"] }),
    busy = fetcher.state !== "idle";
  useEffect(() => {
    setActiveOperation(undefined);
    setOperationStatusError(null);
  }, [id]);
  const title = titleOf(item, kind),
    Icon = icons[kind] || RiServerLine,
    from = useCrumbFrom(title);
  useRefresh(60000);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setEdit(null);
      setOperation(null);
      setCancelOperation(null);
      if (fetcher.data.operation?.resourceId === id)
        setActiveOperation(fetcher.data.operation);
    }
  }, [fetcher.state, fetcher.data, id]);
  const submit = (payload) =>
    fetcher.submit(payload, { method: "post", encType: "application/json" });
  const openEdit = (type, current = "") => {
    setValue(current);
    setReason("");
    setEditError("");
    setEdit(type);
  };
  const startOperation = (key) => {
    setOverruleShutdown(false);
    setOperationSubmitted(false);
    setOperationKey(crypto.randomUUID());
    setStorage("");
    setOperation(key);
  };
  const companyLink = (company) =>
    idOf(company) ? (
      <Link
        to={`${ROOT}/companies/${idOf(company)}`}
        className="text-accent-text hover:underline"
        state={from}
      >
        {nameOf(company)}
      </Link>
    ) : (
      <span className="text-muted-foreground">Не назначена</span>
    );
  const entityLink = (entry, section) =>
    idOf(entry) ? (
      <Link
        className="text-accent-text hover:underline"
        state={from}
        to={`${ROOT}/${section}/${idOf(entry)}`}
      >
        {nameOf(entry)}
      </Link>
    ) : (
      nameOf(entry)
    );
  const inventoryLink = item.clientDeviceId ? (
    <Link
      className="text-accent-text hover:underline"
      state={from}
      to={`/inventory/client-devices/${idOf(item.clientDeviceId)}`}
    >
      {nameOf(item.clientDevice)}
    </Link>
  ) : (
    "Не связано"
  );
  const editCompany = manageable && ["guests", "nodes"].includes(kind);
  const inventoryEditable =
    manageable &&
    can({ device: ["manage"] }) &&
    ["guests", "nodes"].includes(kind);
  const canPower = kind === "guests" && can({ proxmox: ["power"] });
  const latestOperation =
    activeOperation === undefined
      ? item.currentOperation || item.latestOperation
      : activeOperation;
  const operationPending = Boolean(latestOperation?.active);
  const powerReason = powerDisabledReason(
    { ...item, currentOperation: latestOperation },
    operationPending,
  );
  const powerAction = primaryPowerAction(item);
  const relatedSections = Object.entries(related).filter(
    ([key, entries]) =>
      kind !== "connections" &&
      Array.isArray(entries) &&
      entries.length &&
      ["guests", "nodes", "storages"].includes(key) &&
      !(kind === "guests" && key === "storages"),
  );
  const sections = [
    {
      id: "overview",
      label:
        kind === "connections"
          ? "Подключение"
          : kind === "companies"
            ? "Компания"
            : "Размещение",
    },
    ...(resource
      ? [
          { id: "resources", label: "Ресурсы" },
          ...(item.monitoringEnabled !== false &&
          !item.monitoringPausedByConnection
            ? [{ id: "metrics", label: "Графики" }]
            : []),
          { id: "availability", label: "Доступность" },
        ]
      : []),
    ...(kind === "companies" ? [{ id: "totals", label: "Мощности" }] : []),
    ...(kind === "guests"
      ? [
          ...(item.exposure
            ? [{ id: "exposure", label: "Доступ из интернета" }]
            : []),
          { id: "agent", label: "QEMU Guest Agent" },
          { id: "security", label: "Безопасность" },
          { id: "backups", label: "Резервные копии" },
          { id: "operations", label: "Операции ВМ" },
        ]
      : []),
    ...(kind === "nodes"
      ? [
          { id: "security", label: "Безопасность" },
          { id: "updates", label: "Версии и обновления" },
        ]
      : []),
    ...(["guests", "nodes"].includes(kind)
      ? [{ id: "monitoring", label: "Мониторинг" }]
      : []),
    ...relatedSections.map(([key]) => ({
      id: `related-${key}`,
      label: labels[key],
    })),
    ...(resource ? [{ id: "events", label: "Журнал событий" }] : []),
  ];
  const placement =
    kind === "guests"
      ? [
          ["Компания ВМ", companyLink(item.company)],
          [
            "Физический узел",
            <span key="node">
              {entityLink(item.node, "nodes")}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                Владелец: {nameOf(item.node?.company)}
              </span>
            </span>,
          ],
          ["Подключение", entityLink(item.connection, "connections")],
          ["Инвентарь", inventoryLink],
        ]
      : kind === "nodes"
        ? [
            ["Владелец узла", companyLink(item.company)],
            ["Версия Proxmox VE", item.version || "Не получена"],
            ["Подключение", entityLink(item.connection, "connections")],
            ["Инвентарь", inventoryLink],
          ]
        : kind === "storages"
          ? [
              ["Физический узел", item.nodeName || nameOf(item.node)],
              ["Подключение", entityLink(item.connection, "connections")],
              ["Тип", item.storageType || "—"],
              [
                "Размещение",
                item.shared ? "Общее для нескольких узлов" : "Локальное",
              ],
            ]
          : kind === "connections"
            ? [
                ["Компания инфраструктуры", companyLink(item.company)],
                ["ID API-токена", item.tokenId || "—"],
                [
                  "Последнее успешное соединение",
                  date(item.lastSuccessfulConnectionAt),
                ],
              ]
            : kind === "companies"
              ? [
                  [
                    "Компания",
                    <Link
                      key="company"
                      className="text-accent-text hover:underline"
                      state={from}
                      to={`/companies/${id}`}
                    >
                      {title}
                    </Link>,
                  ],
                  ["Учёт ресурсов", "Выделенные мощности ВМ этой компании"],
                ]
              : [];
  const editTitle =
    edit === "company"
      ? "Назначить компанию"
      : edit === "inventory"
        ? "Связать с инвентарём"
        : "Плановое обслуживание";
  const saveEdit = () => {
    if (edit === "maintenance") {
      const until = value ? localToUtc(value) : null;
      if (!until || new Date(until) <= new Date()) {
        setEditError("Укажите дату и время в будущем.");
        return;
      }
      if (!reason.trim()) {
        setEditError("Укажите причину обслуживания.");
        return;
      }
      submit({ intent: "maintenance", kind, until, reason: reason.trim() });
    } else
      submit(
        edit === "company"
          ? { intent: "company", kind, companyId: value }
          : { intent: "inventory", clientDeviceId: value || null },
      );
  };
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Crumbs />
      <header className="mb-5 flex flex-wrap items-start gap-3 sm:gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent text-muted-foreground">
          <Icon size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {kind === "guests" && <ExposureLabel summary={item.exposure} />}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {kind !== "companies" && <Status item={item} kind={kind} />}
            {(resource || kind === "connections") && (
              <span>Проверено: {date(item.lastCheckedAt)}</span>
            )}
          </div>
          {kind === "guests" && (
            <p className="mt-1 text-xs text-faint">
              VMID {item.vmid} ·{" "}
              {item.guestType === "lxc"
                ? "Контейнер LXC"
                : "Виртуальная машина QEMU"}
              {item.template ? " · шаблон" : ""}
              {item.guestOs?.name ? ` · ${item.guestOs.name}` : ""}
            </p>
          )}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {kind === "connections" && manageable && (
            <Button asChild className="flex-1 sm:flex-none">
              <Link to="update">Изменить</Link>
            </Button>
          )}
          {canPower && (
            <Button
              className="flex-1 sm:flex-none"
              disabled={Boolean(powerReason) || busy}
              title={powerReason || undefined}
              onClick={() => startOperation(powerAction)}
            >
              {powerAction === "start" ? <RiPlayLine /> : <RiRestartLine />}
              {actions[powerAction]}
            </Button>
          )}
          {(editCompany ||
            inventoryEditable ||
            canPower ||
            (kind === "connections" && manageable) ||
            (kind === "guests" && can({ proxmox: ["backup"] }))) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Действия с ресурсом"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {["nodes", "guests"].includes(kind) && manageable && (
                  <>
                    <DropdownMenuItem
                      onSelect={() =>
                        submit({
                          intent: "resourceMonitoring",
                          monitoringEnabled: item.monitoringEnabled === false,
                        })
                      }
                    >
                      {item.monitoringEnabled === false
                        ? "Включить мониторинг"
                        : "Отключить мониторинг"}
                    </DropdownMenuItem>
                    {kind === "guests" &&
                      item.guestType === "qemu" &&
                      !item.template && (
                        <>
                          {guestAgentState(item) === "disabled" && (
                            <DropdownMenuItem
                              onSelect={() => setAgentEditor({ enable: true })}
                            >
                              Включить опцию Guest Agent
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() => setAgentEditor({ enable: false })}
                          >
                            Изменить параметры Guest Agent
                          </DropdownMenuItem>
                        </>
                      )}
                    <DropdownMenuSeparator />
                  </>
                )}
                {editCompany && (
                  <DropdownMenuItem
                    onSelect={() =>
                      openEdit("company", idOf(item.company) || item.companyId)
                    }
                  >
                    Назначить компанию
                  </DropdownMenuItem>
                )}
                {inventoryEditable && (
                  <DropdownMenuItem
                    disabled={!item.companyId}
                    onSelect={() =>
                      openEdit(
                        "inventory",
                        idOf(item.clientDevice) || item.clientDeviceId,
                      )
                    }
                  >
                    Связать с инвентарём
                  </DropdownMenuItem>
                )}
                {kind === "guests" && canPower && (
                  <DropdownMenuItem
                    disabled={Boolean(powerReason) || item.status !== "running"}
                    onSelect={() => startOperation("shutdown")}
                  >
                    <RiShutDownLine />
                    {actions.shutdown}
                  </DropdownMenuItem>
                )}
                {canPower && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={
                        Boolean(powerReason) || item.status !== "running"
                      }
                      onSelect={() => startOperation("stop")}
                    >
                      {actions.stop}
                    </DropdownMenuItem>
                  </>
                )}
                {kind === "guests" && can({ proxmox: ["backup"] }) && (
                  <DropdownMenuItem
                    disabled={
                      operationPending ||
                      item.template ||
                      item.freshness !== "fresh"
                    }
                    onSelect={() => startOperation("backup")}
                  >
                    <RiDownloadCloud2Line />
                    Создать резервную копию
                  </DropdownMenuItem>
                )}
                {kind === "connections" && manageable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => startOperation("archive")}
                    >
                      Архивировать подключение
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      {kind === "guests" && (
        <OperationStatus
          operation={latestOperation}
          error={operationStatusError}
          onCancel={
            canCancelOperation(latestOperation) &&
            can({
              proxmox: [
                latestOperation.operation === "backup" ? "backup" : "power",
              ],
            })
              ? () => setCancelOperation(latestOperation)
              : undefined
          }
          journalHref="#operations"
        />
      )}
      <Feedback
        data={
          edit || operation || fetcher.data?.operation ? null : fetcher.data
        }
      />
      {item.lastError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{item.lastError}</AlertDescription>
        </Alert>
      )}
      {canPower && powerReason && (
        <p className="mb-4 text-sm text-muted-foreground">{powerReason}.</p>
      )}
      {kind === "guests" && !item.companyId && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Компания ВМ не назначена. Укажите арендатора для учёта его
                ресурсов.
              </span>
              {manageable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEdit("company")}
                >
                  Назначить компанию
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-start gap-6">
        {sections.length > 1 && (
          <aside className="sticky top-28 hidden w-48 shrink-0 lg:block">
            <AnchorRail sections={sections} />
          </aside>
        )}
        <main className="min-w-0 flex-1">
          {placement.length > 0 && (
            <Section
              title={
                kind === "connections"
                  ? "Подключение"
                  : kind === "companies"
                    ? "Компания"
                    : "Размещение"
              }
              id="overview"
              action={
                editCompany ? (
                  <SectionEditButton
                    label="Компания"
                    editing={false}
                    onToggle={() =>
                      openEdit("company", idOf(item.company) || item.companyId)
                    }
                  />
                ) : null
              }
            >
              <Properties items={placement} />
              {inventoryEditable && (
                <div className="mt-4 border-t border-border-soft pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!item.companyId}
                    onClick={() =>
                      openEdit(
                        "inventory",
                        idOf(item.clientDevice) || item.clientDeviceId,
                      )
                    }
                  >
                    {item.clientDeviceId
                      ? "Изменить связь с инвентарём"
                      : "Связать с инвентарём"}
                  </Button>
                  {!item.companyId && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Сначала назначьте компанию.
                    </p>
                  )}
                </div>
              )}
              {kind === "connections" &&
                item.endpoints?.map((ep, index) => (
                  <div
                    key={`${ep.host}-${ep.port}`}
                    className="mt-4 border-t border-border-soft pt-4"
                  >
                    <div className="mb-2 text-xs text-faint">
                      {index === 0
                        ? "Основной адрес"
                        : `Резервный адрес ${index}`}
                    </div>
                    <p className="break-all text-sm font-semibold">
                      {ep.host}:{ep.port}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {ep.transport === "mikrotik"
                        ? `Через MikroTik · ${ep.mikrotikName || nameOf(options.mikrotik?.find((x) => idOf(x) === idOf(ep.mikrotikRecordId)))}`
                        : "Прямое подключение"}{" "}
                      · {tlsNames[ep.tlsMode] || "HTTPS"}
                    </p>
                  </div>
                ))}
              {kind === "connections" && (
                <SettingRow
                  title="Мониторинг подключения"
                  hint="Опрос состояния узлов и виртуальных машин."
                  htmlFor="proxmox-monitoring"
                >
                  <Switch
                    id="proxmox-monitoring"
                    checked={Boolean(item.monitoringEnabled)}
                    disabled={!manageable || busy}
                    onCheckedChange={(v) =>
                      submit({
                        intent: "connectionMonitoring",
                        monitoringEnabled: v,
                      })
                    }
                  />
                </SettingRow>
              )}
            </Section>
          )}
          {resource && (
            <>
              <Section title="Ресурсы" id="resources">
                <Capacity item={item} kind={kind} />
              </Section>
              {item.monitoringEnabled !== false &&
                !item.monitoringPausedByConnection && (
                  <Metrics id={id} kind={kind} />
                )}
              {["guests", "nodes"].includes(kind) ? (
                <AvailabilityPanel key={id} id={id} item={item} />
              ) : (
                <History id={id} type="availability" />
              )}
            </>
          )}
          {kind === "guests" && (
            <>
              {item.exposure && (
                <ExposureSection
                  key={`exposure-${id}`}
                  resourceId={id}
                  summary={item.exposure}
                  canReadMikrotik={can({ mikrotik: ["read"] })}
                />
              )}
              <GuestAgentPanel
                item={item}
                canManage={manageable && !item.template}
                onEdit={() => setAgentEditor({ enable: false })}
              />
            </>
          )}
          {kind === "guests" && (
            <GuestSecurity
              key={id}
              id={id}
              canCheck={
                manageable &&
                item.monitoringEnabled !== false &&
                !item.monitoringPausedByConnection
              }
              guestType={item.guestType}
            />
          )}
          {kind === "nodes" && (
            <NodeSecurity
              key={id}
              id={id}
              item={item}
              canCheck={
                manageable &&
                item.monitoringEnabled !== false &&
                !item.monitoringPausedByConnection
              }
            />
          )}
          {kind === "companies" && (
            <Section title="Выделенные мощности" id="totals">
              <Properties
                items={[
                  ["ВМ и LXC", item.totals?.count || 0],
                  ["Виртуальные CPU", `${item.totals?.cpu || 0} vCPU`],
                  ["Оперативная память", bytes(item.totals?.memory)],
                  ["Диски", bytes(item.totals?.disk)],
                ]}
              />
              <p className="mt-4 text-xs text-muted-foreground">
                Сумма назначенных этой компании ВМ. Физические серверы могут
                принадлежать другим компаниям.
                {item.totals?.unknownDisk > 0
                  ? ` Объём дисков неизвестен у ${item.totals.unknownDisk} ВМ.`
                  : ""}
              </p>
            </Section>
          )}
          {kind === "guests" && (
            <Section title="Резервные копии" id="backups">
              <Properties
                items={[
                  [
                    "Последняя успешная копия",
                    item.lastBackupAt
                      ? date(item.lastBackupAt)
                      : "Пока не зафиксирована",
                  ],
                ]}
              />
              {item.lastBackupError && (
                <Feedback
                  data={{ error: true, message: item.lastBackupError }}
                />
              )}
              {can({ proxmox: ["backup"] }) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  disabled={
                    operationPending ||
                    item.template ||
                    item.freshness !== "fresh"
                  }
                  onClick={() => startOperation("backup")}
                >
                  <RiDownloadCloud2Line />
                  Создать резервную копию
                </Button>
              )}
            </Section>
          )}
          {["guests", "nodes"].includes(kind) && (
            <Section title="Мониторинг и обслуживание" id="monitoring">
              {kind === "guests" && (
                <SettingRow
                  title="ВМ должна работать постоянно"
                  hint="Остановка этой ВМ считается проблемой доступности."
                  htmlFor="proxmox-expected"
                >
                  <Switch
                    id="proxmox-expected"
                    checked={Boolean(item.expectedRunning)}
                    disabled={!manageable || busy || item.template}
                    onCheckedChange={(v) =>
                      submit({ intent: "monitoring", expectedRunning: v })
                    }
                  />
                </SettingRow>
              )}
              {item.maintenance?.until &&
              new Date(item.maintenance.until) > new Date() ? (
                <div className="mt-3">
                  <p className="text-sm">
                    Обслуживание до {date(item.maintenance.until)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.maintenance.reason}
                  </p>
                  {manageable && (
                    <Button
                      className="mt-3"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        submit({ intent: "maintenance", kind, until: null })
                      }
                    >
                      Завершить обслуживание
                    </Button>
                  )}
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-sm text-muted-foreground">
                    Плановое обслуживание не назначено.
                  </p>
                  {manageable && (
                    <Button
                      className="mt-3"
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit("maintenance")}
                    >
                      Запланировать обслуживание
                    </Button>
                  )}
                </div>
              )}
            </Section>
          )}
          {relatedSections.map(([key, entries]) => (
            <Section
              key={key}
              title={`${labels[key]} · ${entries.length}`}
              id={`related-${key}`}
            >
              <div className="divide-y divide-border-soft">
                {entries.map((entry) => (
                  <Link
                    key={idOf(entry)}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0 hover:text-accent-text"
                    state={from}
                    to={`${ROOT}/${key}/${idOf(entry)}`}
                  >
                    <span className="text-sm font-medium">
                      {nameOf(entry)}
                      {entry.vmid != null && (
                        <span className="ml-2 text-xs text-faint">
                          {entry.vmid}
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {entry.company
                          ? nameOf(entry.company)
                          : key === "guests"
                            ? "Компания не назначена"
                            : ""}
                      </span>
                    </span>
                    <Status item={entry} kind={key} />
                  </Link>
                ))}
              </div>
            </Section>
          ))}
          {kind === "companies" && !relatedSections.length && (
            <Section title="Виртуальные машины" id="related-guests">
              <p className="text-sm text-muted-foreground">
                Этой компании ещё не назначены виртуальные машины.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link to={`${ROOT}/guests`}>Открыть реестр ВМ</Link>
              </Button>
            </Section>
          )}
          {kind === "guests" && (
            <Operations
              id={id}
              version={fetcher.data}
              currentOperation={latestOperation}
              onActiveChange={setActiveOperation}
              onStatusError={setOperationStatusError}
            />
          )}
          {resource && <History id={id} type="events" />}
        </main>
      </div>
      <FormOutlet />
      {agentEditor && (
        <GuestAgentSheet
          key={id}
          item={item}
          open
          enable={agentEditor.enable}
          onOpenChange={(open) => !open && setAgentEditor(null)}
        />
      )}
      <FormSheet
        open={Boolean(edit)}
        onOpenChange={(open) => !open && setEdit(null)}
        title={editTitle}
      >
        <h2 className="mb-5 pr-10 text-xl font-semibold tracking-tight">
          {editTitle}
        </h2>
        {edit === "maintenance" ? (
          <>
            <Field
              label="Окончание обслуживания"
              required
              error={editError}
              hint="До этого времени плановые работы исключаются из расчёта доступности."
            >
              <DateTimeField
                value={value}
                onChange={setValue}
                min={toDateTimeLocal()}
              />
            </Field>
            <TextField
              label="Причина"
              value={reason}
              required
              onChange={(e) => setReason(e.target.value)}
            />
          </>
        ) : (
          <Field
            label={edit === "company" ? "Компания" : "Устройство"}
            hint={
              edit === "company"
                ? "Компания ВМ и владелец физического узла назначаются независимо."
                : "Доступны устройства назначенной этому ресурсу компании."
            }
          >
            <Combobox
              value={value}
              onChange={setValue}
              options={
                edit === "company"
                  ? optionsOf(options.companies)
                  : optionsOf(
                      (options.inventory || []).filter(
                        (entry) =>
                          String(entry.companyId) ===
                          String(item.companyId || idOf(item.company)),
                      ),
                    )
              }
              clearable
            />
          </Field>
        )}
        <Feedback data={fetcher.data} />
        <FormActions className="justify-end">
          <Button variant="ghost" onClick={() => setEdit(null)}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={saveEdit}>
            Сохранить
          </Button>
        </FormActions>
      </FormSheet>
      <CancelOperationDialog
        operation={cancelOperation}
        open={Boolean(cancelOperation)}
        onOpenChange={(open) => !open && setCancelOperation(null)}
        isLoading={busy}
        onConfirm={() =>
          submit({
            intent: "cancelOperation",
            resourceId: id,
            operationId: idOf(cancelOperation),
          })
        }
      >
        <Feedback data={fetcher.data} />
      </CancelOperationDialog>
      <VmOperationDialog
        operation={operation}
        item={item}
        overruleShutdown={overruleShutdown}
        overrideDisabled={operationSubmitted}
        onOverruleShutdownChange={(value) => {
          setOverruleShutdown(value);
          setOperationKey(crypto.randomUUID());
        }}
        open={Boolean(operation) && operation !== "archive"}
        onOpenChange={(open) => !open && setOperation(null)}
        confirmDisabled={
          (operation === "backup" && !storage) ||
          (operation === "stop" && operationPending)
        }
        isLoading={busy}
        onConfirm={() => {
          setOperationSubmitted(true);
          return operation === "archive"
            ? submit({ intent: "archive" })
            : submit({
                intent: "operation",
                operation,
                ...(operation === "backup" ? { storage } : {}),
                idempotencyKey: operationKey,
                ...(operation === "stop" ? { overruleShutdown } : {}),
              });
        }}
      >
        {operation === "backup" && (
          <Field
            label="Хранилище резервной копии"
            required
            hint={
              !related.storages?.length
                ? "Доступные хранилища резервных копий не найдены. Проверьте их настройку и доступность в Proxmox."
                : undefined
            }
          >
            <Combobox
              value={storage}
              options={(related.storages || []).map((s) => ({
                value: s.storage || s.externalId?.split("/").at(-1) || s.name,
                label: nameOf(s),
              }))}
              onChange={setStorage}
            />
          </Field>
        )}
        <Feedback data={fetcher.data} />
      </VmOperationDialog>
      <ConfirmDialog
        open={operation === "archive"}
        onOpenChange={(open) => !open && setOperation(null)}
        title={`Архивировать: ${title}`}
        description="Подключение будет убрано из активного списка, опрос его ресурсов прекратится. Узлы и ВМ в Proxmox сохранятся."
        confirmLabel="Архивировать"
        confirmVariant="destructive"
        isLoading={busy}
        onConfirm={() => submit({ intent: "archive" })}
      >
        <Feedback data={fetcher.data} />
      </ConfirmDialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import {
  RiBuildingLine,
  RiComputerLine,
  RiDatabase2Line,
  RiServerLine,
  RiCheckboxMultipleLine,
} from "react-icons/ri";
import ListWrapper from "@/components/app/ListWrapper";
import ListRow from "@/components/app/ListRow";
import Pager from "@/components/app/Pager";
import BulkActionBar from "@/components/app/BulkActionBar";
import SelectionBar from "@/components/app/SelectionBar";
import FormSheet from "@/components/app/FormSheet";
import { FormActions } from "@/components/app/FormLayout";
import Combobox from "@/components/app/Combobox";
import ChipCombobox from "@/components/app/ChipCombobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCan } from "@/store/authed-user";
import { ROOT } from "./data";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import OperationStatus from "./OperationStatus";
import CancelOperationDialog, {
  canCancelOperation,
} from "./CancelOperationDialog";
import VmOperationDialog, {
  operationLabels,
  powerDisabledReason,
} from "./VmOperationDialog";
import {
  Navigation,
  Status,
  Feedback,
  Field,
  idOf,
  nameOf,
  optionsOf,
  bytes,
  titleOf,
  useRefresh,
} from "./shared";
const config = {
  guests: {
    icon: RiComputerLine,
    search: "Имя или VMID",
    empty: "Виртуальных машин пока нет",
    hint: "После подключения Proxmox здесь появятся его ВМ и LXC.",
  },
  nodes: {
    icon: RiServerLine,
    search: "Название узла",
    empty: "Нет подключённых узлов",
    hint: "Подключите Proxmox, чтобы видеть состояние серверов и выделенные мощности.",
  },
  storages: {
    icon: RiDatabase2Line,
    search: "Название хранилища",
    empty: "Хранилища пока не обнаружены",
    hint: "Список обновляется при синхронизации подключённых узлов.",
  },
  connections: {
    icon: RiServerLine,
    search: "Название подключения",
    empty: "Нет подключений Proxmox",
    hint: "Подключите сервер по локальной сети, VPN, внешнему адресу или через MikroTik.",
  },
  companies: {
    icon: RiBuildingLine,
    empty: "Компаний пока нет",
    hint: "Здесь доступна сводка ресурсов виртуальных машин каждой компании.",
  },
};
function Row({ item, kind, selecting, selected, onToggle, extraActions }) {
  const cfg = config[kind],
    Icon = cfg.icon,
    resources = item.resources || {};
  const title = titleOf(item, kind);
  let meta = "",
    first = null,
    second = null;
  if (kind === "guests") {
    meta = `${item.vmid ?? "—"} · ${item.guestType === "lxc" ? "LXC" : "QEMU"}`;
    first = item.company ? (
      nameOf(item.company)
    ) : (
      <span className="text-warning">Без компании</span>
    );
    second = (
      <>
        <span>{item.nodeName || item.node?.name || "Узел не определён"}</span>
        <span className="block text-xs text-muted-foreground">
          {resources.cpu ?? "—"} vCPU · {bytes(resources.memory)} RAM
        </span>
        {item.node?.company && (
          <span className="block text-xs text-muted-foreground">
            Владелец: {nameOf(item.node.company)}
          </span>
        )}
      </>
    );
  } else if (kind === "nodes") {
    meta = item.cluster
      ? `Кластер: ${item.cluster.name}`
      : item.isCluster === false
        ? "Вне кластера"
        : "Кластер не определён";
    first = nameOf(item.company);
    second = (
      <>
        {resources.cpu ?? "—"} CPU · {bytes(resources.memory)} RAM
      </>
    );
  } else if (kind === "storages") {
    meta = `${item.storageType || "Хранилище"} · ${item.shared ? "Общее" : "Локальное"}`;
    first = item.nodeName || nameOf(item.connection);
    second = `${bytes(resources.diskUsed)} / ${bytes(resources.disk)}`;
  } else if (kind === "connections") {
    const ep = item.endpoints?.[0];
    meta = ep ? `${ep.host}:${ep.port}` : "Адрес не указан";
    first = nameOf(item.company);
    second =
      ep?.transport === "mikrotik" ? "Через MikroTik" : "Прямое подключение";
  } else if (kind === "companies")
    meta = "Виртуальные машины и выделенные мощности";

  return (
    <ListRow
      // updatedAt advances on every monitoring poll, not just user edits.
      // Only creation is meaningful for the shared row's highlight here.
      item={{ _id: idOf(item), createdAt: item.createdAt }}
      title={
        <Link
          to={`${ROOT}/${kind}/${idOf(item)}`}
          onClick={(event) => event.stopPropagation()}
          className="text-foreground hover:text-foreground"
        >
          {title}
        </Link>
      }
      detailTo={`${ROOT}/${kind}/${idOf(item)}`}
      glyph={<Icon size={22} />}
      meta={
        <>
          <span className="block truncate">
            {meta}
            {first != null && <> · {first}</>}
            {kind === "guests" && (
              <span className="lg:hidden">
                {" "}
                · {item.nodeName || item.node?.name || "Узел не определён"}
              </span>
            )}
          </span>
          {kind === "guests" && item.visibleOperation && (
            <OperationStatus
              compact
              operation={item.visibleOperation}
              journalHref={`${ROOT}/guests/${idOf(item)}#operations`}
            />
          )}
          {kind !== "companies" && (
            <span className="mt-0.5 block md:hidden">
              <Status item={item} kind={kind} />
            </span>
          )}
        </>
      }
      column={
        kind !== "companies" && (
          <>
            <span className="hidden min-w-0 flex-1 text-sm text-muted-foreground lg:block">
              {second}
            </span>
            <span className="hidden w-36 shrink-0 text-sm md:block">
              <Status item={item} kind={kind} />
            </span>
          </>
        )
      }
      extraActions={extraActions}
      showExtraActions={Boolean(extraActions)}
      trailing={
        selecting && (
          <Checkbox
            aria-label={`Выбрать ${title}`}
            checked={selected}
            onCheckedChange={onToggle}
          />
        )
      }
    />
  );
}

export default function ProxmoxList() {
  const data = useLoaderData(),
    can = useCan(),
    navigation = useNavigation(),
    fetcher = useFetcher();
  const [query, setQuery] = useSearchParams();
  const operationFetcher = useFetcher();
  const [pendingOperation, setPendingOperation] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [storage, setStorage] = useState("");
  const [receipts, setReceipts] = useState({});
  useEffect(() => {
    const operation = operationFetcher.data?.operation;
    if (operation?.resourceId) {
      setReceipts((previous) => ({
        ...previous,
        [operation.resourceId]: operation,
      }));
      setPendingOperation(null);
      setCancelTarget(null);
    }
  }, [operationFetcher.data]);
  useEffect(() => {
    if (
      operationFetcher.state === "idle" &&
      operationFetcher.data &&
      !operationFetcher.data.error
    )
      setPendingOperation(null);
  }, [operationFetcher.state, operationFetcher.data]);
  const startOperation = (item, operation) => {
    setStorage("");
    setPendingOperation({
      item,
      operation,
      key: crypto.randomUUID(),
      overruleShutdown: false,
      submitted: false,
    });
  };
  const [selected, setSelected] = useState([]),
    [selecting, setSelecting] = useState(false),
    [assign, setAssign] = useState(false),
    [companyId, setCompany] = useState("");
  const {
    kind,
    items: loadedItems = [],
    total = 0,
    page = 1,
    pageSize = 30,
    options = {},
    facets = {},
  } = data;
  const items = loadedItems.map((item) => {
    if (kind !== "guests") return item;
    const receipt = receipts[idOf(item)];
    const server = item.latestOperation || item.currentOperation;
    const visibleOperation = !receipt
      ? server
      : !server
        ? receipt
        : idOf(server) === idOf(receipt)
          ? !receipt.active &&
            server.active &&
            ["cancelled", "succeeded", "failed", "reviewed"].includes(
              receipt.state,
            )
            ? receipt
            : server
          : Date.parse(server.createdAt) >= Date.parse(receipt.createdAt)
            ? server
            : receipt;
    const shownOperation =
      receipt?.cancelRequested &&
      idOf(receipt) === idOf(visibleOperation) &&
      visibleOperation?.active &&
      !visibleOperation.cancelRequested
        ? {
            ...visibleOperation,
            cancelRequested: true,
            cancelRequestedAt: receipt.cancelRequestedAt,
          }
        : visibleOperation;
    return {
      ...item,
      visibleOperation: shownOperation,
      currentOperation: shownOperation?.active
        ? shownOperation
        : idOf(item.currentOperation) === idOf(visibleOperation)
          ? null
          : item.currentOperation,
    };
  });
  const cfg = config[kind];
  const operationRunning = items.some(
    (item) =>
      item.visibleOperation?.active &&
      (item.visibleOperation.state !== "unknown" ||
        item.visibleOperation.cancelRequested),
  );
  useRefresh(
    pendingOperation || cancelTarget || assign || selecting
      ? 0
      : operationRunning
        ? 3000
        : 60000,
  );
  useEffect(() => {
    setSelected([]);
    setSelecting(false);
  }, [kind, query.toString()]);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setAssign(false);
      setSelected([]);
      setSelecting(false);
    }
  }, [fetcher.state, fetcher.data]);
  const update = (key, value) =>
    setQuery((old) => {
      const next = new URLSearchParams(old);
      value ? next.set(key, value) : next.delete(key);
      if (key === "companyId") next.delete("clusterId");
      if (!["page", "more"].includes(key)) {
        next.delete("page");
        next.delete("more");
      }
      return next;
    });
  const sorts = ["companies"].includes(kind)
    ? []
    : [
        { label: "Сначала новые", value: "-createdAt" },
        { label: "По имени", value: "name" },
        { label: "По состоянию", value: "status" },
      ];
  const filterStore = {
    searchTerm: query.get("search") || "",
    fullTextSearch: (value) => update("search", value),
    sortBy: sorts.find((s) => s.value === query.get("sort")) || sorts[0],
    sortingOptions: sorts,
    handleSorting: (s) => update("sort", s.value),
    filteredList: items,
    originalList: items,
    isLoading: navigation.state === "loading",
    resetFilter: () => setQuery({}),
  };
  const filterable = !["companies"].includes(kind);
  const states =
    kind === "guests"
      ? [
          ["running", "Работает"],
          ["stopped", "Остановлена"],
        ]
      : kind === "storages"
        ? [
            ["available", "Доступно"],
            ["unavailable", "Недоступно"],
          ]
        : [
            ["online", "Доступен"],
            ["offline", "Недоступен"],
          ];
  const companyName =
    query.get("companyId") === "unassigned"
      ? "Без компании"
      : nameOf(
          options.companies?.find((c) => idOf(c) === query.get("companyId")),
        );
  const companyOptions = [
    ...(kind === "guests"
      ? [{ value: "unassigned", label: "Без компании" }]
      : []),
    ...optionsOf(options.companies),
  ];
  const clusterOptions = facets.clusters || [];
  const clusterName =
    clusterOptions.find((cluster) => cluster.value === query.get("clusterId"))
      ?.label || "Кластер недоступен";
  const visibleClusterOptions =
    query.get("clusterId") &&
    !clusterOptions.some((cluster) => cluster.value === query.get("clusterId"))
      ? [
          ...clusterOptions,
          { value: query.get("clusterId"), label: clusterName },
        ]
      : clusterOptions;
  const filter = ["guests", "nodes", "connections", "storages"].includes(
    kind,
  ) ? (
    <Field label="Состояние">
      <Combobox
        value={query.get("status")}
        options={states.map(([value, label]) => ({ value, label }))}
        clearable
        onChange={(v) => update("status", v)}
      />
    </Field>
  ) : null;
  const canAdd =
    ["guests", "nodes", "connections"].includes(kind) &&
    can({ proxmox: ["manage"] });
  return (
    <>
      <Feedback data={!assign ? fetcher.data : null} />
      <ListWrapper
        title={() => "Мониторинг Proxmox"}
        count={total}
        filterStore={filterStore}
        filter={filter}
        filterActive={Boolean(query.get("status"))}
        activeFilters={[
          ...(kind === "nodes" && query.get("clusterId")
            ? [
                {
                  key: "cluster",
                  label: clusterName,
                  onRemove: () => update("clusterId", ""),
                },
              ]
            : []),
          ...(query.get("companyId")
            ? [
                {
                  key: "company",
                  label: companyName,
                  onRemove: () => update("companyId", ""),
                },
              ]
            : []),
          ...(query.get("status")
            ? [
                {
                  key: "status",
                  label:
                    states.find(([v]) => v === query.get("status"))?.[1] ||
                    query.get("status"),
                  onRemove: () => update("status", ""),
                },
              ]
            : []),
        ]}
        hasActiveQuery={Boolean(
          query.get("search") ||
            query.get("companyId") ||
            query.get("status") ||
            query.get("clusterId"),
        )}
        searchPlaceholder={cfg.search || "Поиск"}
        showSearch={Boolean(cfg.search)}
        showSortAndCount={sorts.length > 0}
        showAddButton={Boolean(canAdd)}
        addLabel="Новое подключение"
        addRoute={`${ROOT}/connections/add`}
        toolbar={
          <>
            <Navigation />
            {filterable && (
              <ChipCombobox
                placeholder="Все компании"
                allLabel="Все компании"
                searchPlaceholder="Найти компанию…"
                value={query.get("companyId")}
                options={companyOptions}
                onChange={(value) => update("companyId", value)}
              />
            )}
            {kind === "nodes" && (
              <ChipCombobox
                placeholder="Все кластеры"
                allLabel="Все кластеры"
                searchPlaceholder="Найти кластер…"
                emptyText="Для выбранной компании кластеры не найдены"
                value={query.get("clusterId")}
                options={visibleClusterOptions}
                onChange={(value) => update("clusterId", value)}
              />
            )}
            {kind === "guests" &&
              can({ proxmox: ["manage"] }) &&
              items.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelecting((v) => !v)}
                >
                  <RiCheckboxMultipleLine />
                  {selecting ? "Отменить выбор" : "Выбрать"}
                </Button>
              )}
          </>
        }
        emptyTitle={cfg.empty}
        emptyHint={cfg.hint}
        selection={
          selecting && (
            <SelectionBar
              count={selected.length}
              total={items.length}
              allSelected={selected.length === items.length}
              someSelected={selected.length > 0}
              onToggleAll={() =>
                setSelected(
                  selected.length === items.length ? [] : items.map(idOf),
                )
              }
              onSelectAll={() => setSelected(items.map(idOf))}
              onExit={() => {
                setSelecting(false);
                setSelected([]);
              }}
            />
          )
        }
        belowList={
          <Pager
            page={page}
            pageSize={pageSize}
            total={total}
            loaded={items.length}
            onPage={(p) => update("page", String(p))}
            onLoadMore={() =>
              update("more", String(Number(query.get("more") || 1) + 1))
            }
          />
        }
      >
        <div className="appear-children">
          {items.map((item) => (
            <Row
              key={idOf(item)}
              item={item}
              kind={kind}
              extraActions={
                kind === "guests" &&
                (can({ proxmox: ["power"] }) ||
                  can({ proxmox: ["backup"] })) ? (
                  <>
                    {can({ proxmox: ["power"] }) &&
                      (item.status === "stopped"
                        ? ["start"]
                        : ["reboot", "shutdown"]
                      ).map((operation) => (
                        <DropdownMenuItem
                          key={operation}
                          disabled={Boolean(powerDisabledReason(item))}
                          title={powerDisabledReason(item) || undefined}
                          onSelect={() => startOperation(item, operation)}
                        >
                          {operationLabels[operation]}
                        </DropdownMenuItem>
                      ))}
                    {can({ proxmox: ["power"] }) &&
                      item.status !== "stopped" && (
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={Boolean(powerDisabledReason(item))}
                          title={powerDisabledReason(item) || undefined}
                          onSelect={() => startOperation(item, "stop")}
                        >
                          {operationLabels.stop}
                        </DropdownMenuItem>
                      )}
                    {item.currentOperation?.active &&
                      can({
                        proxmox: [
                          item.currentOperation.operation === "backup"
                            ? "backup"
                            : "power",
                        ],
                      }) && (
                        <DropdownMenuItem
                          disabled={!canCancelOperation(item.currentOperation)}
                          title={
                            !canCancelOperation(item.currentOperation) &&
                            !item.currentOperation.cancelRequested
                              ? "Дождитесь отправки команды или проверьте результат в журнале ВМ"
                              : undefined
                          }
                          onSelect={() => setCancelTarget(item)}
                        >
                          {item.currentOperation.cancelRequested
                            ? "Отмена запрошена"
                            : "Отменить операцию"}
                        </DropdownMenuItem>
                      )}
                    {can({ proxmox: ["backup"] }) && (
                      <DropdownMenuItem
                        disabled={Boolean(powerDisabledReason(item))}
                        title={powerDisabledReason(item) || undefined}
                        onSelect={() => startOperation(item, "backup")}
                      >
                        {operationLabels.backup}
                      </DropdownMenuItem>
                    )}
                  </>
                ) : null
              }
              selecting={selecting}
              selected={selected.includes(idOf(item))}
              onToggle={(value) =>
                setSelected((s) =>
                  value
                    ? [...s, idOf(item)]
                    : s.filter((id) => id !== idOf(item)),
                )
              }
            />
          ))}
        </div>
      </ListWrapper>
      {!pendingOperation && !operationFetcher.data?.operation && (
        <Feedback data={operationFetcher.data} />
      )}
      {pendingOperation && (
        <VmOperationDialog
          item={pendingOperation.item}
          operation={pendingOperation.operation}
          open
          onOpenChange={(open) => !open && setPendingOperation(null)}
          isLoading={operationFetcher.state !== "idle"}
          overruleShutdown={pendingOperation.overruleShutdown}
          overrideDisabled={pendingOperation.submitted}
          onOverruleShutdownChange={(value) =>
            setPendingOperation((previous) => ({
              ...previous,
              overruleShutdown: value,
              key: crypto.randomUUID(),
            }))
          }
          confirmDisabled={pendingOperation.operation === "backup" && !storage}
          onConfirm={() => {
            setPendingOperation((previous) => ({
              ...previous,
              submitted: true,
            }));
            operationFetcher.submit(
              {
                intent: "operation",
                resourceId: idOf(pendingOperation.item),
                operation: pendingOperation.operation,
                idempotencyKey: pendingOperation.key,
                ...(pendingOperation.operation === "backup" ? { storage } : {}),
                ...(pendingOperation.operation === "stop"
                  ? { overruleShutdown: pendingOperation.overruleShutdown }
                  : {}),
              },
              { method: "post", encType: "application/json" },
            );
          }}
        >
          {pendingOperation.operation === "backup" && (
            <Field label="Хранилище резервной копии" required>
              <Combobox
                ariaLabel="Хранилище резервной копии"
                value={storage}
                onChange={setStorage}
                options={(options.storages || [])
                  .filter(
                    (entry) =>
                      String(entry.connectionId) ===
                        String(
                          pendingOperation.item.connectionId ||
                            idOf(pendingOperation.item.connection),
                        ) && entry.nodeName === pendingOperation.item.nodeName,
                  )
                  .map((entry) => ({ value: entry.id, label: entry.name }))}
              />
            </Field>
          )}
          <Feedback data={operationFetcher.data} />
        </VmOperationDialog>
      )}
      {cancelTarget && (
        <CancelOperationDialog
          operation={cancelTarget.currentOperation}
          open
          onOpenChange={(open) => !open && setCancelTarget(null)}
          isLoading={operationFetcher.state !== "idle"}
          onConfirm={() =>
            operationFetcher.submit(
              {
                intent: "cancelOperation",
                resourceId: idOf(cancelTarget),
                operationId: idOf(cancelTarget.currentOperation),
              },
              { method: "post", encType: "application/json" },
            )
          }
        >
          <Feedback data={operationFetcher.data} />
        </CancelOperationDialog>
      )}
      <BulkActionBar
        count={selected.length}
        actions={[
          { key: "company", icon: RiBuildingLine, label: "Назначить компанию" },
        ]}
        onPick={() => {
          setCompany("");
          setAssign(true);
        }}
        onClear={() => {
          setSelected([]);
          setSelecting(false);
        }}
      />
      <FormSheet
        open={assign}
        onOpenChange={setAssign}
        title="Назначить компанию"
      >
        <h2 className="mb-2 pr-10 text-xl font-semibold tracking-tight">
          Назначить компанию
        </h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Выбрано ВМ: {selected.length}. Владельцы физических узлов не
          изменятся.
        </p>
        <Field
          label="Компания ВМ"
          hint="Оставьте поле пустым, чтобы снять назначение."
        >
          <Combobox
            value={companyId}
            options={optionsOf(options.companies)}
            onChange={setCompany}
            clearable
          />
        </Field>
        <Feedback data={fetcher.data} />
        <FormActions className="justify-end">
          <Button variant="ghost" onClick={() => setAssign(false)}>
            Отмена
          </Button>
          <Button
            disabled={fetcher.state !== "idle"}
            onClick={() =>
              fetcher.submit(
                {
                  intent: "bulkCompany",
                  ids: selected,
                  companyId: companyId || null,
                },
                { method: "post", encType: "application/json" },
              )
            }
          >
            Сохранить
          </Button>
        </FormActions>
      </FormSheet>
    </>
  );
}

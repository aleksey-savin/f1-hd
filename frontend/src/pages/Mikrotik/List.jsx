import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { RiDraftLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";

import ListWrapper from "@/components/app/ListWrapper";
import ListGroupLabel from "@/components/app/ListGroupLabel";
import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";

import DeviceFilter, {
  FIRMWARE_OPTIONS,
  STATUS_OPTIONS,
} from "../../components/Mikrotik/DeviceFilter";
import DeviceRow from "../../components/Mikrotik/DeviceRow";
import DeviceSheet from "../../components/Mikrotik/DeviceSheet";
import RouterOsStrip from "../../components/Mikrotik/RouterOsStrip";

import usePolling from "../../hooks/use-polling";
import { useCan } from "@/store/authed-user";
import useMikrotikDeviceFilterStore, {
  rowStatus,
} from "../../store/lists/mikrotik-devices";

// Порядок групп: проблемы всплывают наверх; внутри — выбранная сортировка.
const GROUPS = [
  { key: "offline", label: "Не в сети", labelClass: "text-destructive" },
  { key: "online", label: "В сети" },
  { key: "disabled", label: "Мониторинг выключен", tone: "off" },
];

const optionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label || value;

// Мониторинг Mikrotik: статус-борд парка устройств. Список идёт от записей
// мониторинга (добавление — только «Новое устройство», связь с инвентарём —
// шагом после проверки); строки группируются по статусу, обновляются тихим
// поллингом каждые 15 с; клик по строке — шторка-превью справа.
const MikrotikDevices = () => {
  const can = useCan();
  const canManage = can({ mikrotik: ["manageDevices"] });
  const filterStore = useMikrotikDeviceFilterStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeRecordId, setActiveRecordId] = useState(null);

  useEffect(() => {
    filterStore.fetch();
  }, []);

  // Постоянное фоновое автообновление (как на странице заявок): статусы,
  // доступность и индикаторы прошивки подтягиваются без спиннера; опрос на
  // паузе, пока вкладка скрыта, при возврате фокуса — сразу.
  usePolling(() => filterStore.silentRefresh(), { intervalMs: 15000 });

  // Deep-link из заявки, «Окружения» и карточки устройства: ?recordId= /
  // ?clientDeviceId= открывает шторку, параметр снимается из адреса.
  useEffect(() => {
    const recordId = searchParams.get("recordId");
    const clientDeviceId = searchParams.get("clientDeviceId");
    if (!recordId && !clientDeviceId) return;
    if (!filterStore.originalList.length) return;

    const row = recordId
      ? filterStore.originalList.find((item) => item.recordId === recordId)
      : filterStore.originalList.find(
          (item) => String(item.clientDeviceId) === clientDeviceId,
        );
    if (row) setActiveRecordId(row.recordId);

    const next = new URLSearchParams(searchParams);
    next.delete("recordId");
    next.delete("clientDeviceId");
    setSearchParams(next, { replace: true });
  }, [searchParams, filterStore.originalList]);

  // Шторка живёт на строке из стора: тихий поллинг обновляет её содержимое.
  const activeRow = useMemo(
    () =>
      activeRecordId
        ? filterStore.originalList.find(
            (row) => row.recordId === activeRecordId,
          ) || null
        : null,
    [activeRecordId, filterStore.originalList],
  );

  const companyOptions = useMemo(() => {
    const byId = new Map();
    for (const row of filterStore.originalList) {
      if (row.company?.id) {
        byId.set(String(row.company.id), row.company.name);
      }
    }
    return [...byId.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [filterStore.originalList]);

  const typeOptions = useMemo(() => {
    const kinds = new Set(
      filterStore.originalList.map((row) => row.type).filter(Boolean),
    );
    return [...kinds]
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((kind) => ({ value: kind, label: kind }));
  }, [filterStore.originalList]);

  // Группировка по статусу; заголовки исчезают, когда группа осталась одна.
  const groups = useMemo(() => {
    const byStatus = { offline: [], online: [], disabled: [] };
    for (const row of filterStore.filteredList) {
      (byStatus[rowStatus(row)] || byStatus.offline).push(row);
    }
    return GROUPS.map((group) => ({
      ...group,
      rows: byStatus[group.key],
    })).filter((group) => group.rows.length > 0);
  }, [filterStore.filteredList]);

  const { facets, setFacet } = filterStore;
  const activeFilters = [
    ...(facets.status
      ? [
          {
            key: "status",
            label: `Статус: ${optionLabel(STATUS_OPTIONS, facets.status)}`,
            onRemove: () => setFacet("status", null),
          },
        ]
      : []),
    ...facets.companies.map((companyId) => ({
      key: `company-${companyId}`,
      label: `Компания: ${optionLabel(companyOptions, companyId)}`,
      onRemove: () =>
        setFacet(
          "companies",
          facets.companies.filter((entry) => entry !== companyId),
        ),
    })),
    ...(facets.type
      ? [
          {
            key: "type",
            label: `Тип: ${facets.type}`,
            onRemove: () => setFacet("type", null),
          },
        ]
      : []),
    ...(facets.firmware
      ? [
          {
            key: "firmware",
            label: `Прошивка: ${optionLabel(
              FIRMWARE_OPTIONS,
              facets.firmware,
            ).toLowerCase()}`,
            onRemove: () => setFacet("firmware", null),
          },
        ]
      : []),
  ];

  return (
    <>
      <ListWrapper
        title={() => "Мониторинг Mikrotik"}
        filterStore={filterStore}
        filter={
          <DeviceFilter
            companyOptions={companyOptions}
            typeOptions={typeOptions}
          />
        }
        filterActive={activeFilters.length > 0}
        activeFilters={activeFilters}
        toolbar={
          <ChipMultiCombobox
            placeholder="Все компании"
            searchPlaceholder="Найти компанию…"
            countLabel={(count) => `Компании: ${count}`}
            value={facets.companies}
            options={companyOptions}
            onChange={(value) => setFacet("companies", value)}
          />
        }
        searchPlaceholder="Найти устройство…"
        showAddButton={canManage}
        addRoute="add"
        addLabel="Новое устройство"
        topContent={
          // Ряд под шапкой: полоса RouterOS + «Диапазоны сетей» (переехали из
          // меню «Отчёты»; строка инструментов и без того плотная, а правый
          // край этого ряда свободен).
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="min-w-0 flex-1">
              <RouterOsStrip />
            </div>
            {canManage && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="flex-none text-muted-foreground"
              >
                <Link to="/report/networks">
                  <RiDraftLine aria-hidden />
                  Диапазоны сетей
                </Link>
              </Button>
            )}
          </div>
        }
      >
        <div>
          {groups.map((group) => (
            <div key={group.key}>
              {groups.length > 1 && (
                <ListGroupLabel
                  label={group.label}
                  count={group.rows.length}
                  tone={group.tone || "on"}
                  className={group.labelClass}
                />
              )}
              {group.rows.map((row) => (
                <DeviceRow
                  key={row.recordId}
                  row={row}
                  onOpen={() => setActiveRecordId(row.recordId)}
                />
              ))}
            </div>
          ))}
        </div>
      </ListWrapper>

      <DeviceSheet
        row={activeRow}
        onClose={() => setActiveRecordId(null)}
        canManage={canManage}
      />
    </>
  );
};

export default MikrotikDevices;

export async function loader() {
  document.title = "Мониторинг Mikrotik";

  return null;
}

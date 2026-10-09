import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { isMobile } from "react-device-detect";

import {
  RiArrowUpCircleLine,
  RiCheckboxMultipleLine,
  RiDraftLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiPencilLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";

import ListWrapper from "@/components/app/ListWrapper";
import ListGroupLabel from "@/components/app/ListGroupLabel";
import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import Segmented from "@/components/app/Segmented";
import SelectionBar from "@/components/app/SelectionBar";
import BulkActionBar from "@/components/app/BulkActionBar";

import DeviceFilter, {
  BACKUP_OPTIONS,
  FIRMWARE_OPTIONS,
  LICENSE_OPTIONS,
  STATUS_OPTIONS,
} from "../../components/Mikrotik/DeviceFilter";
import DeviceRow from "../../components/Mikrotik/DeviceRow";
import RouterOsStrip, {
  BRANCH_LABEL,
} from "../../components/Mikrotik/RouterOsStrip";
import UpgradeBanner from "../../components/Mikrotik/UpgradeBanner";
import UpgradeDialog from "../../components/Mikrotik/UpgradeDialog";
import UpgradeSheet from "../../components/Mikrotik/UpgradeSheet";

import useLiveTopic from "@/hooks/use-live-topic";
import useListSelection from "@/hooks/use-list-selection";
import { useCan } from "@/store/authed-user";
import useMikrotikDeviceFilterStore, {
  accessCounts,
  rowStatus,
} from "../../store/lists/mikrotik-devices";

// Порядок групп: проблемы всплывают наверх; внутри — выбранная сортировка.
const GROUPS = [
  { key: "offline", label: "Не в сети", labelClass: "text-destructive" },
  { key: "online", label: "В сети" },
  { key: "disabled", label: "Мониторинг выключен", tone: "off" },
];

// Бейдж применённого фильтра «Права HD» — полные названия, как метка строки
const ACCESS_LABEL = {
  read: "только чтение",
  write: "чтение и запись",
  noWrite: "нет прав на запись",
};

const optionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label || value;

// Стабильный пустой список для закрытого диалога: новый `[]` на каждом
// рендере перезапускал бы его эффект плана.
const NO_IDS = [];

// Мониторинг Mikrotik: статус-борд парка устройств. Список идёт от записей
// мониторинга (добавление — только «Новое устройство», связь с инвентарём —
// шагом после проверки); строки группируются по статусу, обновляются тихо по
// пульсу живых обновлений; клик по строке — страница записи.
const MikrotikDevices = () => {
  const can = useCan();
  const canManage = can({ mikrotik: ["manage"] });
  const canUpgrade = can({ mikrotik: ["upgradeFirmware"] });
  const currentUpgrade = useMikrotikDeviceFilterStore(
    (state) => state.currentUpgrade,
  );
  const [upgradeIds, setUpgradeIds] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const filterStore = useMikrotikDeviceFilterStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    filterStore.fetch();
    filterStore.fetchCurrentUpgrade();
  }, []);

  // Пакет закончился — шторка не должна всплыть сама на следующем.
  useEffect(() => {
    if (!currentUpgrade) setSheetOpen(false);
  }, [currentUpgrade]);

  // Живое обновление (docs/live-updates.md): переход онлайн/офлайн, смена
  // прошивки, правки записей и тревожные заявки подтягиваются без спиннера,
  // когда пульс сообщает об изменении. Раз в 5 минут — в любом случае: «время
  // проверки» и доступность за 30 дней текут и без событий. Идущий пакет
  // обновления прошивки едет тем же пульсом — вместе со списком.
  useLiveTopic(
    "mikrotik",
    () => {
      filterStore.silentRefresh();
      filterStore.fetchCurrentUpgrade();
    },
    { maxStaleMs: 5 * 60_000 },
  );

  // Deep-link из заявки, «Окружения» и карточки устройства: ?recordId= ведёт
  // сразу на страницу записи; ?clientDeviceId= — как только список приехал и
  // запись нашлась (не нашлась — остаёмся на списке, параметр снимаем).
  useEffect(() => {
    const recordId = searchParams.get("recordId");
    const clientDeviceId = searchParams.get("clientDeviceId");
    if (!recordId && !clientDeviceId) return;
    if (recordId) {
      navigate(`/devices/mikrotik/records/${recordId}`, { replace: true });
      return;
    }
    if (!filterStore.originalList.length) return;

    const row = filterStore.originalList.find(
      (item) => String(item.clientDeviceId) === clientDeviceId,
    );
    if (row) {
      navigate(`/devices/mikrotik/records/${row.recordId}`, { replace: true });
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("clientDeviceId");
    setSearchParams(next, { replace: true });
  }, [searchParams, filterStore.originalList]);

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

  // Выбор устройств для обновления прошивки (макет, экран 1). Хук ждёт `_id`,
  // у строки борда адрес — recordId.
  const selectionItems = useMemo(
    () => filterStore.filteredList.map((row) => ({ _id: row.recordId })),
    [filterStore.filteredList],
  );
  const selection = useListSelection({
    items: selectionItems,
    enabled: canUpgrade,
  });

  const upgradeReason =
    selection.count === 0
      ? "Выберите устройства"
      : currentUpgrade
        ? "Идёт другое обновление — дождитесь его окончания"
        : null;

  const { facets, setFacet } = filterStore;

  // Сегмент «Права HD» рядом с чипом компаний (макет «Фильтр по правам HD»,
  // 30.09): app/Segmented как есть — иконка метки строки, короткая подпись,
  // число среза; полное название — в подсказке. На телефоне — своей строкой
  // во всю ширину в конце ряда инструментов, плотным кеглем.
  const counts = accessCounts(filterStore);
  const iconSize = isMobile ? 12 : 14;
  const accessOptions = [
    { value: "all", label: "Все", count: counts.all },
    {
      value: "read",
      label: "Чтение",
      count: counts.read,
      icon: <RiEyeLine size={iconSize} aria-hidden />,
      title: "Только чтение — «Обновление прошивки из HD» выключено",
    },
    {
      value: "write",
      label: "Запись",
      count: counts.write,
      icon: <RiPencilLine size={iconSize} aria-hidden />,
      title: "Чтение и запись — «Обновление прошивки из HD» включено",
    },
    {
      value: "noWrite",
      label: "Нет прав",
      count: counts.noWrite,
      icon: <RiErrorWarningLine size={iconSize} aria-hidden />,
      title:
        "Нет прав на запись — обновление включено, но группа пользователя HD на устройстве не даёт прав write, reboot и policy",
    },
  ];

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
    ...(facets.license
      ? [
          {
            key: "license",
            label: `Лицензия: ${optionLabel(
              LICENSE_OPTIONS,
              facets.license,
            ).toLowerCase()}`,
            onRemove: () => setFacet("license", null),
          },
        ]
      : []),
    ...(facets.backup
      ? [
          {
            key: "backup",
            label: `Копии: ${optionLabel(
              BACKUP_OPTIONS,
              facets.backup,
            ).toLowerCase()}`,
            onRemove: () => setFacet("backup", null),
          },
        ]
      : []),
    ...(facets.access
      ? [
          {
            key: "access",
            label: `Права: ${ACCESS_LABEL[facets.access] || facets.access}`,
            onRemove: () => setFacet("access", null),
          },
        ]
      : []),
    // Чип полосы RouterOS — такой же применённый фильтр, как остальные
    ...(facets.branch
      ? [
          {
            key: "branch",
            label: `Отстают от ${BRANCH_LABEL[facets.branch] || facets.branch}`,
            onRemove: () => setFacet("branch", null),
          },
        ]
      : []),
  ];

  const networksLink = canManage && (
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
  );

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
          <>
            <ChipMultiCombobox
              placeholder="Все компании"
              searchPlaceholder="Найти компанию…"
              countLabel={(count) => `Компании: ${count}`}
              value={facets.companies}
              options={companyOptions}
              onChange={(value) => setFacet("companies", value)}
            />
            <Segmented
              options={accessOptions}
              value={facets.access || "all"}
              onChange={(value) =>
                setFacet("access", value === "all" ? null : value)
              }
              ariaLabel="Права HD"
              fit
              compact={isMobile}
              className="max-md:order-last max-md:w-full"
            />
            {canUpgrade && !selection.isActive && (
              <Button
                variant="outline"
                size="icon"
                title="Выбрать несколько"
                aria-label="Выбрать несколько устройств"
                onClick={() => selection.enter()}
              >
                <RiCheckboxMultipleLine />
              </Button>
            )}
          </>
        }
        selection={
          selection.isActive ? (
            <SelectionBar
              count={selection.count}
              total={selection.total}
              allSelected={selection.allSelected}
              someSelected={selection.someSelected}
              onToggleAll={
                selection.allSelected
                  ? selection.clearSelection
                  : selection.selectAll
              }
              onSelectAll={selection.selectAll}
              onExit={selection.exit}
            />
          ) : null
        }
        showAddButton={canManage}
        addRoute="add"
        addLabel="Новое устройство"
        topContent={
          // Ряд под шапкой: полоса RouterOS + «Диапазоны сетей» (переехали из
          // меню «Отчёты»; строка инструментов и без того плотная, а правый
          // край этого ряда свободен). На телефоне ссылка уезжает в строку
          // заголовка полосы — рядом с плитками ей места нет. Ниже — баннер
          // идущего пакета обновления прошивки (макет, экран 3).
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="min-w-0 flex-1">
                <RouterOsStrip mobileAside={networksLink || null} />
              </div>
              {networksLink && (
                <div className="max-md:hidden">{networksLink}</div>
              )}
            </div>
            {currentUpgrade && (
              <UpgradeBanner
                job={currentUpgrade}
                onOpen={() => setSheetOpen(true)}
              />
            )}
          </>
        }
      >
        <div className="appear-children">
          {groups.map((group) => (
            <div key={group.key} className="appear-children">
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
                  canManage={canManage}
                  selectionActive={selection.isActive}
                  isSelected={selection.isSelected(row.recordId)}
                  onToggle={selection.toggle}
                  pressProps={selection.pressProps(row.recordId)}
                  consumeSuppressedClick={selection.consumeSuppressedClick}
                />
              ))}
            </div>
          ))}
        </div>
      </ListWrapper>

      {canUpgrade && (
        <BulkActionBar
          count={selection.count}
          show={selection.isActive}
          actions={[
            {
              key: "upgrade",
              icon: RiArrowUpCircleLine,
              label: "Обновить прошивку",
              reason: upgradeReason,
            },
          ]}
          onPick={() => setUpgradeIds(selection.selectedIds)}
          statusText={
            selection.count > 0
              ? `Выбрано: ${selection.count}`
              : "Ничего не выбрано"
          }
        />
      )}
      <UpgradeDialog
        open={Boolean(upgradeIds)}
        onOpenChange={(open) => !open && setUpgradeIds(null)}
        recordIds={upgradeIds || NO_IDS}
        onStarted={() => {
          selection.exit();
          filterStore.fetchCurrentUpgrade();
        }}
      />
      <UpgradeSheet
        job={currentUpgrade}
        open={sheetOpen && Boolean(currentUpgrade)}
        onOpenChange={setSheetOpen}
        canCancel={canUpgrade}
      />
    </>
  );
};

export default MikrotikDevices;

export async function loader() {
  document.title = "Мониторинг Mikrotik";

  return null;
}

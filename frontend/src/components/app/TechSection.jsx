import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  RiArrowRightSLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiListUnordered,
  RiMapPin2Line,
  RiSearchLine,
  RiServerLine,
  RiStarFill,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import Spinner from "./Spinner";
import Segmented from "./Segmented";
import ChipMultiCombobox from "./ChipMultiCombobox";
import Environment from "./Environment";
import EnvironmentDeviceSheet from "./EnvironmentDeviceSheet";
import {
  STATUS_META,
  EnvStatusText,
  mikrotikStatus,
  deviceIcon,
} from "./EnvironmentDeviceTile";
import { Eyebrow, SubLabel } from "./Panel";
import useHttp from "../../hooks/use-http";
import { getLocalStorageData } from "../../util/auth";
import { plural } from "../../util/plural";

// Выбранное представление помнится между карточками и сессиями.
const VIEW_KEY = "hd-tech-view";
// Без активного запроса список ограничен, дальше — по ссылке в раздел.
const ROW_LIMIT = 10;

const VIEW_OPTIONS = [
  { value: "list", label: "Список", icon: <RiListUnordered size={15} /> },
  { value: "env", label: "Окружение", icon: <RiMapPin2Line size={15} /> },
];

const LIVE_DOT = {
  ok: "tw:bg-primary",
  bad: "tw:bg-destructive",
  off: "tw:bg-faint",
};

// Строка поиска по устройству (клиентская фильтрация, как на странице
// «Устройства»).
const haystack = (device) =>
  [
    device.name,
    device.typeName,
    device.vendorName,
    device.locationName,
    device.inventoryNumber,
    device.serialNumber,
    device.ipAddress,
    device.operatingSystem,
    STATUS_META[device.status]?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const uniqueOptions = (devices, pick) => {
  const seen = new Set();
  const options = [];
  devices.forEach((device) => {
    const value = pick(device);
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push(value);
  });
  return options
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((value) => ({ value, label: value }));
};

// Строка техники — жёсткие колонки: плитка (live-точка связи Mikrotik — как
// кольцо присутствия), имя + «Тип · Вендор · Инв №», расположение, учётный
// статус текстом с точкой, «↗» по наведению. Клик по строке — шторка.
const TechRow = ({ device, onSelect }) => {
  const Icon = deviceIcon(device.typeName);
  const status = STATUS_META[device.status];
  const mikro = mikrotikStatus(device);
  const meta = [device.typeName, device.vendorName, device.inventoryNumber]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(device)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(device);
        }
      }}
      title="Открыть карточку устройства"
      className="tw:group tw:flex tw:cursor-pointer tw:items-center tw:gap-3 tw:rounded-lg tw:px-2.5 tw:py-2 tw:transition-colors tw:hover:bg-accent"
    >
      <span
        aria-hidden
        className="tw:relative tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
      >
        <Icon size={17} />
        {mikro && (
          <span
            title={mikro.label}
            className={cn(
              "tw:absolute tw:-right-0.5 tw:-bottom-0.5 tw:size-2.5 tw:rounded-full tw:ring-2 tw:ring-card",
              LIVE_DOT[mikro.tone],
            )}
          />
        )}
      </span>

      <span className="tw:min-w-0 tw:flex-1">
        <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-[15px] tw:leading-snug tw:font-medium">
          <span className="tw:min-w-0 tw:truncate" title={device.name}>
            {device.name}
          </span>
          {device.isPersonal && (
            <RiStarFill
              size={13}
              className="tw:flex-none tw:text-warning"
              title="Закреплено лично"
            />
          )}
        </span>
        {meta && (
          <span className="tw:block tw:truncate tw:text-sm tw:text-muted-foreground">
            {meta}
          </span>
        )}
        {/* На узких экранах статус и расположение — подстрокой */}
        <span className="tw:mt-0.5 tw:flex tw:min-w-0 tw:items-center tw:gap-2.5 tw:md:hidden">
          {status && (
            <EnvStatusText tone={status.tone}>{status.label}</EnvStatusText>
          )}
          <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-xs tw:text-faint">
            <RiMapPin2Line size={12} className="tw:flex-none" />
            <span className="tw:truncate">
              {device.locationName ||
                (device.isPersonal ? "лично, без расположения" : "—")}
            </span>
          </span>
        </span>
      </span>

      <span className="tw:hidden tw:w-48 tw:flex-none tw:items-center tw:gap-1.5 tw:text-sm tw:text-muted-foreground tw:md:flex">
        <RiMapPin2Line size={14} className="tw:flex-none tw:text-faint" />
        {device.locationName ? (
          <span className="tw:truncate" title={device.locationName}>
            {device.locationName}
          </span>
        ) : (
          <span className="tw:text-faint">
            {device.isPersonal ? "лично, без расположения" : "—"}
          </span>
        )}
      </span>

      <span className="tw:hidden tw:w-36 tw:flex-none tw:md:block">
        {status && (
          <EnvStatusText tone={status.tone}>{status.label}</EnvStatusText>
        )}
      </span>

      <span className="tw:hidden tw:w-8 tw:flex-none tw:place-items-center tw:md:grid">
        <Link
          to={`/inventory/client-devices/${device._id}`}
          title="Открыть карточку устройства"
          aria-label="Открыть карточку устройства"
          onClick={(event) => event.stopPropagation()}
          className="tw:grid tw:size-8 tw:place-items-center tw:rounded-lg tw:text-faint tw:no-underline tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:hover:bg-accent tw:hover:text-muted-foreground tw:focus-visible:opacity-100 tw:pointer-coarse:opacity-100"
        >
          <RiExternalLinkLine size={15} />
        </Link>
      </span>
    </div>
  );
};

// Секция «Техника» карточки (компании или пользователя): одни данные в двух
// представлениях — «Список» (строки с фасетами страницы «Устройства») и
// «Окружение» (zoom-виджет). Метка секции и сегмент представлений — здесь же;
// клик по строке открывает общую шторку устройства.
const TechSection = ({ id, companyId, userId, subject = "applicant" }) => {
  const { token } = getLocalStorageData();
  const { isLoading, error, sendRequest } = useHttp();

  const [view, setView] = useState(
    () => localStorage.getItem(VIEW_KEY) || "list",
  );
  const changeView = (next) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  const [data, setData] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [locations, setLocations] = useState([]);

  useEffect(() => {
    if (!companyId && !userId) return;
    const base = import.meta.env.VITE_API_ADDRESS;
    const url = companyId
      ? `${base}/api/inventory/locations/company/${companyId}/tech`
      : `${base}/api/inventory/locations/user/${userId}/tech`;
    sendRequest({ url, headers: { Authorization: "Bearer " + token } }, setData);
  }, [companyId, userId, token, sendRequest]);

  // Единый формат: массив групп (у компании — одна безымянная)
  const groups = useMemo(() => {
    if (!data) return [];
    if (companyId) return [{ key: "all", label: null, devices: data.devices || [] }];
    return data.groups || [];
  }, [data, companyId]);
  const allDevices = useMemo(() => groups.flatMap((g) => g.devices), [groups]);
  const total = data?.total ?? null;

  const typeOptions = useMemo(
    () => uniqueOptions(allDevices, (d) => d.typeName),
    [allDevices],
  );
  const vendorOptions = useMemo(
    () => uniqueOptions(allDevices, (d) => d.vendorName),
    [allDevices],
  );
  const statusOptions = useMemo(() => {
    const seen = new Set();
    return allDevices
      .map((d) => d.status)
      .filter((s) => s && STATUS_META[s] && !seen.has(s) && seen.add(s))
      .map((s) => ({ value: s, label: STATUS_META[s].label }));
  }, [allDevices]);
  const locationOptions = useMemo(
    () => (companyId ? uniqueOptions(allDevices, (d) => d.locationName) : []),
    [allDevices, companyId],
  );

  const hasActiveQuery = Boolean(
    query.trim() ||
      types.length ||
      vendors.length ||
      statuses.length ||
      locations.length,
  );

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.map((group) => ({
      ...group,
      devices: group.devices.filter(
        (d) =>
          (!q || haystack(d).includes(q)) &&
          (!types.length || types.includes(d.typeName)) &&
          (!vendors.length || vendors.includes(d.vendorName)) &&
          (!statuses.length || statuses.includes(d.status)) &&
          (!locations.length || locations.includes(d.locationName)),
      ),
    }));
  }, [groups, query, types, vendors, statuses, locations]);
  const matchedCount = filteredGroups.reduce(
    (sum, g) => sum + g.devices.length,
    0,
  );

  // Без запроса — лимит строк сквозь группы; с запросом показываем все совпадения
  const visibleGroups = useMemo(() => {
    if (hasActiveQuery) return filteredGroups.filter((g) => g.devices.length);
    let budget = ROW_LIMIT;
    return filteredGroups
      .map((group) => {
        const take = Math.min(group.devices.length, Math.max(budget, 0));
        budget -= take;
        return { ...group, devices: group.devices.slice(0, take) };
      })
      .filter((g) => g.devices.length);
  }, [filteredGroups, hasActiveQuery]);
  const shownCount = visibleGroups.reduce(
    (sum, g) => sum + g.devices.length,
    0,
  );

  const resetFilters = () => {
    setQuery("");
    setTypes([]);
    setVendors([]);
    setStatuses([]);
    setLocations([]);
  };

  const badges = [
    ...types.map((v) => ({ k: "Тип", label: v, onRemove: () => setTypes(types.filter((x) => x !== v)) })),
    ...vendors.map((v) => ({ k: "Вендор", label: v, onRemove: () => setVendors(vendors.filter((x) => x !== v)) })),
    ...statuses.map((v) => ({
      k: "Статус",
      label: STATUS_META[v]?.label || v,
      onRemove: () => setStatuses(statuses.filter((x) => x !== v)),
    })),
    ...locations.map((v) => ({ k: "Расположение", label: v, onRemove: () => setLocations(locations.filter((x) => x !== v)) })),
  ];

  const allDevicesLink = companyId
    ? `/inventory/client-devices?company=${companyId}`
    : `/inventory/client-devices?user=${userId}`;
  const showSearch = (total ?? 0) > 8;
  const counterText = hasActiveQuery
    ? `Найдено: ${matchedCount}`
    : total > shownCount
      ? `Показаны ${shownCount} из ${total}`
      : total != null
        ? `${total} ${plural(total, "устройство", "устройства", "устройств")}`
        : "";

  const chipClass = "tw:h-8 tw:px-3";
  const segmented = (className) => (
    <Segmented
      ariaLabel="Представление техники"
      options={VIEW_OPTIONS}
      value={view}
      onChange={changeView}
      className={className}
    />
  );

  return (
    <>
      <Eyebrow
        id={id}
        count={total ?? undefined}
        action={<span className="tw:max-md:hidden">{segmented()}</span>}
      >
        Техника
      </Eyebrow>
      <div className="tw:mb-2.5 tw:md:hidden">{segmented("tw:w-full")}</div>

      {view === "env" ? (
        <Environment companyId={companyId} userId={userId} subject={subject} />
      ) : isLoading || (!data && !error) ? (
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card">
          <Spinner className="tw:min-h-48" />
        </div>
      ) : error ? (
        <div className="tw:flex tw:items-center tw:gap-2.5 tw:rounded-lg tw:border tw:border-border-soft tw:bg-accent/50 tw:px-3.5 tw:py-2.5 tw:text-sm tw:text-muted-foreground">
          <RiServerLine size={16} className="tw:flex-none tw:text-faint" />
          Не удалось загрузить технику.
        </div>
      ) : total === 0 ? (
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
          <div className="tw:flex tw:flex-col tw:items-center tw:px-5 tw:py-4 tw:text-center">
            <span
              aria-hidden
              className="tw:grid tw:size-12 tw:place-items-center tw:rounded-xl tw:bg-accent tw:text-faint tw:inset-ring tw:inset-ring-border"
            >
              <RiServerLine size={22} />
            </span>
            <div className="tw:mt-3.5 tw:text-base tw:font-semibold">
              Техники в учёте пока нет
            </div>
            <p className="tw:mx-auto tw:mt-1.5 tw:mb-0 tw:max-w-md tw:text-sm tw:text-muted-foreground">
              {companyId
                ? "У компании нет устройств в учёте техники — они появятся здесь после добавления в разделе «Устройства»."
                : "За пользователем не закреплено устройств, а его рабочее место пусто."}
            </p>
          </div>
        </div>
      ) : (
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card">
          {/* Тулбар: поиск + фасеты страницы «Устройства» (минус контекст карточки) */}
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-border-soft tw:px-4 tw:py-3">
            {showSearch && (
              <label className="tw:flex tw:h-8 tw:min-w-0 tw:basis-52 tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-input tw:bg-background tw:px-2.5 tw:max-md:basis-full">
                <RiSearchLine size={15} className="tw:flex-none tw:text-faint" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Поиск по технике"
                  aria-label="Поиск по технике"
                  className="tw:min-w-0 tw:flex-1 tw:appearance-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:outline-none tw:placeholder:text-faint"
                />
              </label>
            )}
            <ChipMultiCombobox
              placeholder="Тип"
              countLabel={(n) => `Тип (${n})`}
              value={types}
              options={typeOptions}
              onChange={setTypes}
              className={chipClass}
            />
            <ChipMultiCombobox
              placeholder="Вендор"
              countLabel={(n) => `Вендор (${n})`}
              value={vendors}
              options={vendorOptions}
              onChange={setVendors}
              className={chipClass}
            />
            <ChipMultiCombobox
              placeholder="Статус"
              countLabel={(n) => `Статус (${n})`}
              value={statuses}
              options={statusOptions}
              onChange={setStatuses}
              className={chipClass}
            />
            {companyId && (
              <ChipMultiCombobox
                placeholder="Расположение"
                countLabel={(n) => `Расположение (${n})`}
                value={locations}
                options={locationOptions}
                onChange={setLocations}
                className={chipClass}
              />
            )}
            {counterText && (
              <span className="tw:ms-auto tw:text-sm tw:text-faint tw:tabular-nums tw:max-md:hidden">
                {counterText}
              </span>
            )}
          </div>

          {/* Применённые фильтры всегда видны — снимаемые бейджи */}
          {badges.length > 0 && (
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:px-4 tw:pt-2.5">
              {badges.map((badge) => (
                <span
                  key={`${badge.k}:${badge.label}`}
                  className="tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border-soft tw:bg-accent tw:py-0.5 tw:ps-2.5 tw:pe-1 tw:text-sm"
                >
                  <span className="tw:text-muted-foreground">{badge.k}:</span>{" "}
                  {badge.label}
                  <button
                    type="button"
                    onClick={badge.onRemove}
                    aria-label={`Снять фильтр «${badge.label}»`}
                    className="tw:grid tw:size-5 tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-full tw:border-0 tw:bg-transparent tw:p-0 tw:text-faint tw:hover:bg-destructive/10 tw:hover:text-destructive"
                  >
                    <RiCloseLine size={13} />
                  </button>
                </span>
              ))}
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Сбросить
              </Button>
            </div>
          )}

          {/* Список: у пользователя — группы источников, у компании — плоско */}
          <div className="tw:p-2">
            {matchedCount === 0 ? (
              <div className="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:px-4 tw:py-6 tw:text-center tw:text-sm tw:text-faint">
                Ничего не нашлось. Измените запрос или сбросьте фильтры.
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Сбросить
                </Button>
              </div>
            ) : (
              visibleGroups.map((group, groupIndex) => (
                <div key={group.key}>
                  {group.label && (
                    <SubLabel
                      count={
                        filteredGroups.find((g) => g.key === group.key)?.devices
                          .length
                      }
                      className={cn(
                        "tw:px-2.5 tw:pt-3",
                        groupIndex === 0 && "tw:pt-1.5",
                      )}
                    >
                      {group.label}
                    </SubLabel>
                  )}
                  {group.devices.map((device, index) => (
                    <div key={device._id}>
                      {index > 0 && (
                        <div className="tw:mx-2.5 tw:h-px tw:bg-border-soft" />
                      )}
                      <TechRow device={device} onSelect={setSelectedDevice} />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="tw:border-t tw:border-border-soft tw:px-4 tw:py-3">
            <Link
              to={allDevicesLink}
              className="tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-semibold tw:text-accent-text tw:no-underline tw:hover:underline"
            >
              Вся техника в «Устройствах» ({total}){" "}
              <RiArrowRightSLine size={16} />
            </Link>
          </div>
        </div>
      )}

      <EnvironmentDeviceSheet
        device={selectedDevice}
        personalLabel={
          subject === "user"
            ? "Закреплено лично за пользователем"
            : "Закреплено лично за заявителем"
        }
        onClose={() => setSelectedDevice(null)}
      />
    </>
  );
};

export default TechSection;

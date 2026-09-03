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
  DEVICE_STATUS_META,
  DeviceStatusText,
  mikrotikStatus,
  deviceIcon,
} from "./device-status";
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
  ok: "bg-primary",
  bad: "bg-destructive",
  off: "bg-faint",
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
    DEVICE_STATUS_META[device.status]?.label,
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
  const status = DEVICE_STATUS_META[device.status];
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
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent"
    >
      <span
        aria-hidden
        className="relative grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border"
      >
        <Icon size={17} />
        {mikro && (
          <span
            title={mikro.label}
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
              LIVE_DOT[mikro.tone],
            )}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm leading-snug font-medium">
          <span className="min-w-0 truncate" title={device.name}>
            {device.name}
          </span>
          {device.isPersonal && (
            <RiStarFill
              size={13}
              className="flex-none text-warning"
              title="Закреплено лично"
            />
          )}
        </span>
        {meta && (
          <span className="block truncate text-sm text-muted-foreground">
            {meta}
          </span>
        )}
        {/* На узких экранах статус и расположение — подстрокой */}
        <span className="mt-0.5 flex min-w-0 items-center gap-2.5 md:hidden">
          {status && (
            <DeviceStatusText tone={status.tone}>
              {status.label}
            </DeviceStatusText>
          )}
          <span className="flex min-w-0 items-center gap-1 text-xs text-faint">
            <RiMapPin2Line size={12} className="flex-none" />
            <span className="truncate">
              {device.locationName ||
                (device.isPersonal ? "лично, без расположения" : "—")}
            </span>
          </span>
        </span>
      </span>

      <span className="hidden w-48 flex-none items-center gap-1.5 text-sm text-muted-foreground md:flex">
        <RiMapPin2Line size={14} className="flex-none text-faint" />
        {device.locationName ? (
          <span className="truncate" title={device.locationName}>
            {device.locationName}
          </span>
        ) : (
          <span className="text-faint">
            {device.isPersonal ? "лично, без расположения" : "—"}
          </span>
        )}
      </span>

      <span className="hidden w-36 flex-none md:block">
        {status && (
          <DeviceStatusText tone={status.tone}>{status.label}</DeviceStatusText>
        )}
      </span>

      <span className="hidden w-8 flex-none place-items-center md:grid">
        <Link
          to={`/inventory/client-devices/${device._id}`}
          title="Открыть карточку устройства"
          aria-label="Открыть карточку устройства"
          onClick={(event) => event.stopPropagation()}
          className="grid size-8 place-items-center rounded-lg text-faint no-underline opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-muted-foreground focus-visible:opacity-100 pointer-coarse:opacity-100"
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
//
// Данные: GET /locations/company/:companyId/tech (порядок строк — DFS-обход
// иерархии расположений, поэтому сортировать на клиенте не нужно) либо
// GET /locations/user/:userId/tech. Обе ручки отдают строку в DTO toEnvDevice —
// того же формата, что и «Окружение», поэтому шторка устройства открывается без
// дозапроса. Техника пользователя приходит уже разложенной бэкендом по группам:
// «Личная и рабочее место» (без рабочего места — «Закреплено лично») и
// «В помещении — X» (прямая техника родителя рабочего места); у компании группа
// одна, безымянная.
const TechSection = ({
  id,
  companyId,
  userId,
  subject = "applicant",
  // Своя техника: адрес без id, скоуп считает токен. Так блок «Моё рабочее
  // место» работает у клиента, которому раздел учёта не открыт.
  self = false,
  // Метка секции. На карточках это «Техника» (предмет — учёт), на главной
  // клиента — «Моё рабочее место»: там же те же данные отвечают на другой
  // вопрос, «что вокруг меня стоит».
  label = "Техника",
  // Прятать секцию целиком, когда учёт пуст. На карточке заглушка нужна — она
  // объясняет, где техника появляется; на лендинге секций много, и плакат
  // «Техники пока нет» отжимал бы вниз то, ради чего страницу открыли.
  hideWhenEmpty = false,
}) => {
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
    if (!companyId && !userId && !self) return;
    const base = import.meta.env.VITE_API_ADDRESS;
    // «Своё» ходит по отдельному адресу вне /inventory: тот целиком закрыт
    // правом инженера, которого у клиента нет и быть не должно (см. шапку
    // routes/internal/myWorkplace.js). Ответ по форме тот же — группы.
    const url = self
      ? `${base}/api/my-workplace`
      : companyId
        ? `${base}/api/inventory/locations/company/${companyId}/tech`
        : `${base}/api/inventory/locations/user/${userId}/tech`;
    sendRequest(
      { url, headers: {} },
      setData,
    );
  }, [companyId, userId, self, token, sendRequest]);

  // Единый формат: массив групп (у компании — одна безымянная)
  const groups = useMemo(() => {
    if (!data) return [];
    if (companyId)
      return [{ key: "all", label: null, devices: data.devices || [] }];
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
      .filter((s) => s && DEVICE_STATUS_META[s] && !seen.has(s) && seen.add(s))
      .map((s) => ({ value: s, label: DEVICE_STATUS_META[s].label }));
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
    ...types.map((v) => ({
      k: "Тип",
      label: v,
      onRemove: () => setTypes(types.filter((x) => x !== v)),
    })),
    ...vendors.map((v) => ({
      k: "Вендор",
      label: v,
      onRemove: () => setVendors(vendors.filter((x) => x !== v)),
    })),
    ...statuses.map((v) => ({
      k: "Статус",
      label: DEVICE_STATUS_META[v]?.label || v,
      onRemove: () => setStatuses(statuses.filter((x) => x !== v)),
    })),
    ...locations.map((v) => ({
      k: "Расположение",
      label: v,
      onRemove: () => setLocations(locations.filter((x) => x !== v)),
    })),
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

  const chipClass = "h-8 px-3";
  const segmented = (className) => (
    <Segmented
      ariaLabel="Представление техники"
      options={VIEW_OPTIONS}
      value={view}
      onChange={changeView}
      className={className}
    />
  );

  // Пока данных нет, решить «пусто ли» нельзя — на лендинге молчим до ответа,
  // иначе секция мигает заголовком и исчезает.
  if (hideWhenEmpty && (!data || total === 0)) return null;

  return (
    <>
      <Eyebrow
        id={id}
        count={total ?? undefined}
        // «Окружение» строит семантический зум по всей физической иерархии, а
        // его ручка — внутри закрытого клиенту /inventory. Переключателя,
        // который у половины зрителей ведёт в 403, не бывает: в режиме `self`
        // остаётся один список.
        action={
          self ? undefined : (
            <span className="max-md:hidden">{segmented()}</span>
          )
        }
      >
        {label}
      </Eyebrow>
      {!self && <div className="mb-2.5 md:hidden">{segmented("w-full")}</div>}

      {view === "env" && !self ? (
        <Environment companyId={companyId} userId={userId} subject={subject} />
      ) : isLoading || (!data && !error) ? (
        <div className="rounded-xl border border-border bg-card">
          <Spinner className="min-h-48" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border-soft bg-accent/50 px-3.5 py-2.5 text-sm text-muted-foreground">
          <RiServerLine size={16} className="flex-none text-faint" />
          Не удалось загрузить технику.
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col items-center px-5 py-4 text-center">
            <span
              aria-hidden
              className="grid size-12 place-items-center rounded-xl bg-accent text-faint inset-ring inset-ring-border"
            >
              <RiServerLine size={22} />
            </span>
            <div className="mt-3.5 text-base font-semibold">
              Техники в учёте пока нет
            </div>
            <p className="mx-auto mt-1.5 mb-0 max-w-md text-sm text-muted-foreground">
              {companyId
                ? "У компании нет устройств в учёте техники — они появятся здесь после добавления в разделе «Устройства»."
                : "За пользователем не закреплено устройств, а его рабочее место пусто."}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          {/* Тулбар: поиск + фасеты страницы «Устройства» (минус контекст карточки) */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-4 py-3">
            {showSearch && (
              <label className="flex h-8 min-w-0 basis-52 items-center gap-2 rounded-lg border border-input bg-background px-2.5 max-md:basis-full">
                <RiSearchLine size={15} className="flex-none text-faint" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Поиск по технике"
                  aria-label="Поиск по технике"
                  className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm outline-none placeholder:text-faint"
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
              <span className="ms-auto text-sm text-faint tabular-nums max-md:hidden">
                {counterText}
              </span>
            )}
          </div>

          {/* Применённые фильтры всегда видны — снимаемые бейджи */}
          {badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-2.5">
              {badges.map((badge) => (
                <span
                  key={`${badge.k}:${badge.label}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-accent py-0.5 ps-2.5 pe-1 text-sm"
                >
                  <span className="text-muted-foreground">{badge.k}:</span>{" "}
                  {badge.label}
                  <button
                    type="button"
                    onClick={badge.onRemove}
                    aria-label={`Снять фильтр «${badge.label}»`}
                    className="grid size-5 cursor-pointer appearance-none place-items-center rounded-full border-0 bg-transparent p-0 text-faint hover:bg-destructive/10 hover:text-destructive"
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
          <div className="p-2">
            {matchedCount === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-faint">
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
                        "px-2.5 pt-3",
                        groupIndex === 0 && "pt-1.5",
                      )}
                    >
                      {group.label}
                    </SubLabel>
                  )}
                  {group.devices.map((device, index) => (
                    <div key={device._id}>
                      {index > 0 && (
                        <div className="mx-2.5 h-px bg-border-soft" />
                      )}
                      <TechRow device={device} onSelect={setSelectedDevice} />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Раздел «Устройства» клиенту не открыт — ссылка туда была бы
              обещанием, которого интерфейс не держит. */}
          {!self && (
            <div className="border-t border-border-soft px-4 py-3">
              <Link
                to={allDevicesLink}
                className="inline-flex items-center gap-1 text-sm font-semibold text-accent-text no-underline hover:underline"
              >
                Вся техника в «Устройствах» ({total}){" "}
                <RiArrowRightSLine size={16} />
              </Link>
            </div>
          )}
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

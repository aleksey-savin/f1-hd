import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  RiAddFill,
  RiArrowRightSLine,
  RiBox3Line,
  RiInboxLine,
  RiMapPin2Line,
  RiUser3Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/app/Panel";
import SearchBar from "@/components/app/SearchBar";
import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import Spinner from "@/components/app/Spinner";
import {
  DEVICE_STATUS_META,
  DeviceStatusText,
} from "@/components/app/device-status";
import { api } from "@/lib/api";
import { useCan } from "@/store/authed-user";

import FleetStrip from "../ClientDevice/FleetStrip";
import { plural } from "../../util/plural";

// Порция секции: 20 строк, дальше — «Показать ещё» той же порцией
const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

/**
 * Строка устройства модели. Плитки нет — у всех строк одна модель, и глиф
 * ничего не различал бы (правило плитки). Имя — имя в сети, если оно есть:
 * у одинаковых устройств различает именно оно; ниже — инв. № и серийный.
 * Колонки: компания · у кого/где · статус. Узкий экран — три строки.
 */
const ModelDeviceRow = ({ device, crumbState }) => {
  const status = DEVICE_STATUS_META[device.status];
  const title =
    device.hostname || device.inventoryNumber || device.serialNumber || device.name;
  const ids = [
    title !== device.inventoryNumber && device.inventoryNumber,
    device.serialNumber !== title && device.serialNumber,
  ].filter(Boolean);

  // Деталь сборки живёт там, где её хозяин: место — «в составе: …»
  const place = device.parent
    ? {
        icon: RiBox3Line,
        main: `в составе: ${device.parent.inventoryNumber || device.parent.name}`,
        sub: null,
      }
    : device.user
      ? { icon: RiUser3Line, main: device.user.name, sub: device.location?.name }
      : { icon: RiMapPin2Line, main: device.location?.name || null, sub: null };
  const PlaceIcon = place.icon;
  const placeLine =
    [place.main, place.sub].filter(Boolean).join(" · ") || "не размещено";

  return (
    <Link
      to={`/inventory/client-devices/${device._id}`}
      state={crumbState}
      className="group relative flex items-center gap-4 px-5 py-2.5 text-foreground no-underline transition-colors before:absolute before:top-0 before:right-0 before:left-0 before:h-px before:bg-border-soft hover:bg-accent/60 max-md:block max-md:px-4 max-md:py-3"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate text-base leading-tight font-medium">
            {title}
          </span>
          {status && (
            <DeviceStatusText tone={status.tone} className="text-sm md:hidden">
              {status.label}
            </DeviceStatusText>
          )}
        </span>
        {ids.length > 0 && (
          <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground max-md:hidden">
            {ids[0]}
            {ids[1] && <span className="text-faint"> · {ids[1]}</span>}
          </span>
        )}
        {/* Узкий экран: номер · компания, ниже — у кого/где */}
        <span className="mt-0.5 block truncate text-sm text-muted-foreground md:hidden">
          {device.inventoryNumber && (
            <span className="font-mono text-xs">{device.inventoryNumber}</span>
          )}
          {device.inventoryNumber && device.company && " · "}
          {device.company?.name}
        </span>
        <span className="block truncate text-xs text-faint md:hidden">
          {placeLine}
        </span>
      </span>

      <span className="hidden w-38 flex-none truncate text-sm lg:block">
        {device.company?.name || <span className="text-faint">—</span>}
      </span>

      <span className="hidden w-55 min-w-0 flex-none items-center gap-2 md:flex">
        <PlaceIcon size={15} className="flex-none text-faint" aria-hidden />
        <span className="min-w-0">
          {place.main ? (
            <>
              <span className="block truncate text-sm" title={place.main}>
                {place.main}
              </span>
              {place.sub && (
                <span
                  className="block truncate text-xs text-faint"
                  title={place.sub}
                >
                  {place.sub}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-faint">не размещено</span>
          )}
        </span>
      </span>

      <span className="hidden w-36 flex-none md:block">
        {status && (
          <DeviceStatusText tone={status.tone} className="text-sm">
            {status.label}
          </DeviceStatusText>
        )}
      </span>

      <RiArrowRightSLine
        size={18}
        aria-hidden
        className="hidden flex-none text-faint md:block"
      />
    </Link>
  );
};

/**
 * Секция «Устройства» карточки модели: вся техника этой модели — с
 * компанией и местом, быстрыми фильтрами (поиск, компании, стадии) и
 * порциями по 20 строк. «Новое устройство» открывает мастер на карточке
 * с уже выбранной моделью (маршрут `devices/add`).
 *
 * Данные — общая ручка реестра с фасетом `models`; детали сборок входят
 * (`components=any`): модель памяти иначе показала бы пустоту. После
 * создания из мастера секция перечитывается — по смене location.key, когда
 * снова стоим на самой карточке.
 */
const DevicesSection = ({ modelId, crumbState }) => {
  const location = useLocation();
  const can = useCan();
  const canAdd = Boolean(can({ device: ["manage"] }));

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState([]);
  const [companies, setCompanies] = useState([]);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusCounts, setStatusCounts] = useState({});
  const [companyOptions, setCompanyOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  // Всего устройств модели без фильтров — отличает «пусто» от «не нашлось»
  const [unfilteredTotal, setUnfilteredTotal] = useState(null);

  // Поиск — с задержкой: запрос на каждую букву гонял бы ручку реестра
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filtered = Boolean(search) || statuses.length > 0 || companies.length > 0;
  const onCard = location.pathname.replace(/\/$/, "").endsWith(modelId);
  const requestRef = useRef(0);

  const fetchPage = async (nextPage) => {
    const params = new URLSearchParams({
      models: modelId,
      components: "any",
      sort: "inventory",
      limit: String(PAGE_SIZE),
      page: String(nextPage),
      companyCounts: "true",
    });
    if (search) params.set("search", search);
    if (statuses.length) params.set("statuses", statuses.join(","));
    if (companies.length) params.set("companies", companies.join(","));
    return api(`/api/inventory/client-devices?${params}`);
  };

  // Первая порция: при смене фильтров и при возврате на карточку из мастера
  useEffect(() => {
    if (!onCard) return;
    const request = ++requestRef.current;
    setLoading(true);
    fetchPage(1)
      .then((data) => {
        if (request !== requestRef.current) return;
        setRows(data.devices || []);
        setTotal(data.total || 0);
        setPage(1);
        setStatusCounts(data.statusCounts || {});
        setCompanyOptions(data.companyCounts || []);
        if (!filtered) setUnfilteredTotal(data.total || 0);
        setFailed(false);
      })
      .catch(() => {
        // Секция — не вся страница: сбой списка не роняет карточку модели
        if (request === requestRef.current) setFailed(true);
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, [modelId, search, statuses, companies, onCard ? location.key : null]);

  const showMore = async () => {
    const request = requestRef.current;
    setLoadingMore(true);
    try {
      const data = await fetchPage(page + 1);
      if (request !== requestRef.current) return;
      setRows((current) => [...current, ...(data.devices || [])]);
      setTotal(data.total || 0);
      setPage(page + 1);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleStatus = (status) =>
    setStatuses((current) =>
      current.includes(status)
        ? current.filter((entry) => entry !== status)
        : [...current, status],
    );
  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatuses([]);
    setCompanies([]);
  };

  const addButton = canAdd && (
    <Button asChild size="sm">
      <Link to="devices/add">
        <RiAddFill /> Новое устройство
      </Link>
    </Button>
  );

  const remaining = Math.max(total - rows.length, 0);
  const noDevices = !loading && !failed && unfilteredTotal === 0 && !filtered;

  return (
    <>
      <Eyebrow
        id="devices"
        count={unfilteredTotal ?? undefined}
        action={addButton}
      >
        Устройства
      </Eyebrow>

      {noDevices ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-6 py-9 text-center">
          <RiInboxLine size={40} aria-hidden className="mb-1 text-faint" />
          <div className="text-base font-semibold">
            Устройств этой модели пока нет
          </div>
          <p className="my-0 max-w-md text-sm text-muted-foreground">
            Новое устройство заведётся сразу с этой моделью.
          </p>
          {addButton && <div className="mt-2">{addButton}</div>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-2.5 px-5 pt-3.5 pb-1 max-md:px-4">
            <div className="flex items-center gap-2 max-md:flex-wrap">
              <SearchBar
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Имя, инв. №, серийный, сотрудник…"
                ariaLabel="Поиск по устройствам модели"
                className="w-80 max-md:w-full"
              />
              {companyOptions.length > 1 || companies.length > 0 ? (
                <ChipMultiCombobox
                  placeholder="Все компании"
                  searchPlaceholder="Найти компанию…"
                  countLabel={(count) => `Компании: ${count}`}
                  value={companies}
                  options={companyOptions}
                  onChange={setCompanies}
                />
              ) : null}
            </div>
            <FleetStrip
              label={null}
              className="mb-1.5 px-0 max-md:-mx-4 max-md:px-4"
              statusCounts={statusCounts}
              selected={statuses}
              onToggle={toggleStatus}
            />
          </div>

          {failed && rows.length === 0 ? (
            <p className="my-0 border-t border-border-soft px-5 py-6 text-sm text-muted-foreground">
              Не удалось загрузить устройства. Обновите страницу.
            </p>
          ) : loading && rows.length === 0 ? (
            <div className="flex justify-center border-t border-border-soft py-8">
              <Spinner size={28} />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 border-t border-border-soft px-6 py-9 text-center">
              <div className="text-base font-semibold">Ничего не нашлось</div>
              <p className="my-0 text-sm text-muted-foreground">
                Измените запрос или сбросьте фильтры.
              </p>
              <Button variant="outline" className="mt-1" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            </div>
          ) : (
            <div className={loading ? "opacity-60 transition-opacity" : undefined}>
              {rows.map((device) => (
                <ModelDeviceRow
                  key={device._id}
                  device={device}
                  crumbState={crumbState}
                />
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex items-center gap-3 border-t border-border-soft px-5 py-2.5 text-sm text-faint tabular-nums max-md:px-4">
              <span className="min-w-0 flex-1">
                {remaining > 0
                  ? `Показаны ${rows.length} из ${total}`
                  : filtered
                    ? `Найдено ${total}`
                    : `${total} ${plural(total, "устройство", "устройства", "устройств")} модели`}
              </span>
              {remaining > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={showMore}
                  disabled={loadingMore}
                >
                  {loadingMore && <Spinner size={14} />}
                  Показать ещё {Math.min(PAGE_SIZE, remaining)}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default DevicesSection;

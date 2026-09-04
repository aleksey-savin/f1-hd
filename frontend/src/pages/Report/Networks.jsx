import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";
import { RiArrowLeftSLine, RiDownloadLine } from "react-icons/ri";

import Crumbs from "@/components/app/Crumbs";
import PageShell from "@/components/app/PageShell";
import SearchBar from "@/components/app/SearchBar";
import { Eyebrow } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";

import NetworksStrip from "../../components/Mikrotik/NetworksStrip";
import NetworksOverlaps from "../../components/Mikrotik/NetworksOverlaps";
import {
  NetworkAddressRow,
  NetworksDeviceList,
  NetworksTable,
} from "../../components/Mikrotik/NetworksRegistry";
import { exportNetworksToExcel } from "../../components/Mikrotik/networks-export";
import { OVERLAP_ORDER } from "../../components/Mikrotik/meta";
import { plural } from "../../util/plural";

// Ключ сортировки по адресу: строкой «46.x» встаёт после «192.x», а
// «10.0.0.1» — перед «1.0.0.10». Тот же порядок бэкенд даёт по умолчанию
// (controllers/inventory/mikrotik.js), здесь он нужен для смены направления и
// для колонки «Сеть».
const addressSortKey = (value) => {
  const [ip = "", mask = ""] = String(value || "").split("/");
  const octets = ip.split(".").map((part) => Number(part) || 0);
  while (octets.length < 4) octets.push(0);
  return (
    octets.slice(0, 4).reduce((acc, part) => acc * 256 + part, 0) * 64 +
    (Number(mask) || 0)
  );
};

const NUMERIC_KEYS = ["address", "network"];

const sortEntries = (entries, sort) => {
  const numeric = NUMERIC_KEYS.includes(sort.key);
  const sorted = [...entries].sort((a, b) => {
    const compared = numeric
      ? addressSortKey(a[sort.key]) - addressSortKey(b[sort.key])
      : String(a[sort.key] || "").localeCompare(
          String(b[sort.key] || ""),
          "ru",
        );
    // Адрес — вторичный ключ у всех колонок: без него строки одного устройства
    // перетасовываются при каждой перерисовке.
    return compared || addressSortKey(a.address) - addressSortKey(b.address);
  });
  return sort.direction === "desc" ? sorted.reverse() : sorted;
};

const SEARCH_FIELDS = [
  "address",
  "network",
  "interface",
  "deviceName",
  "comment",
];

// Поиск нечувствителен к регистру С ОБЕИХ сторон: прежний отчёт сравнивал сырой
// ввод с приведённой строкой, и «GRE» не находил gre-tunnel1.
const matches = (entry, terms) =>
  terms.every((term) =>
    SEARCH_FIELDS.some((field) =>
      String(entry[field] || "")
        .toLowerCase()
        .includes(term),
    ),
  );

const Networks = () => {
  const { entries, overlaps, totals } = useLoaderData();

  const [search, setSearch] = useState("");
  const [kinds, setKinds] = useState([]);
  const [showDisabled, setShowDisabled] = useState(false);
  const [sort, setSort] = useState({ key: "address", direction: "asc" });
  // Мобильный drill-down: выбранное устройство занимает весь экран.
  const [openDevice, setOpenDevice] = useState(null);

  // Счётчики ленты считаются по всей выборке и БЕЗ фасета причины: причина у
  // сети ровно одна, поэтому выбор одной не обнуляет соседние.
  const counts = useMemo(() => {
    const result = {};
    for (const overlap of overlaps) {
      result[overlap.kind] = (result[overlap.kind] || 0) + 1;
    }
    return result;
  }, [overlaps]);

  const terms = useMemo(
    () => search.trim().toLowerCase().split(" ").filter(Boolean),
    [search],
  );

  const visibleEntries = useMemo(() => {
    let rows = entries;
    if (!showDisabled) rows = rows.filter((entry) => !entry.disabled);
    if (kinds.length)
      rows = rows.filter((entry) => kinds.includes(entry.overlap));
    if (terms.length) rows = rows.filter((entry) => matches(entry, terms));
    return sortEntries(rows, sort);
  }, [entries, showDisabled, kinds, terms, sort]);

  const visibleOverlaps = useMemo(() => {
    let groups = overlaps;
    if (kinds.length)
      groups = groups.filter((group) => kinds.includes(group.kind));
    if (terms.length) {
      groups = groups.filter((group) =>
        group.addresses.some((entry) => matches(entry, terms)),
      );
    }
    return groups;
  }, [overlaps, kinds, terms]);

  const devices = useMemo(() => {
    const byName = new Map();
    for (const entry of visibleEntries) {
      const device = byName.get(entry.deviceName);
      if (device) device.entries.push(entry);
      else
        byName.set(entry.deviceName, {
          name: entry.deviceName,
          entries: [entry],
        });
    }
    return [...byName.values()]
      .map((device) => ({
        ...device,
        // Самая тревожная причина внутри — точка у имени устройства.
        worstOverlap: OVERLAP_ORDER.find((kind) =>
          device.entries.some((entry) => entry.overlap === kind),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [visibleEntries]);

  const toggleKind = (kind) =>
    setKinds((current) =>
      current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind],
    );

  const changeSearch = (event) => {
    setSearch(event.target.value);
    // Поиск отвечает на вопрос обо всём парке, а не об открытом устройстве —
    // из drill-down он выпрыгивает в плоский список.
    setOpenDevice(null);
  };

  const drilledEntries = openDevice
    ? visibleEntries.filter((entry) => entry.deviceName === openDevice)
    : null;

  const overlapsInDevice = drilledEntries
    ? drilledEntries.filter((entry) => entry.overlap).length
    : 0;

  const narrowed = terms.length > 0 || kinds.length > 0;

  return (
    <PageShell
      title={openDevice || "Диапазоны сетей"}
      subtitle={
        openDevice
          ? `${drilledEntries.length} ${plural(drilledEntries.length, "адрес", "адреса", "адресов")}${
              overlapsInDevice ? ` · ${overlapsInDevice} в пересечениях` : ""
            }`
          : `${totals.devices} ${plural(totals.devices, "устройство", "устройства", "устройств")} · ${totals.addresses} ${plural(totals.addresses, "адрес", "адреса", "адресов")} · ${totals.networks} ${plural(totals.networks, "сеть", "сети", "сетей")}`
      }
      breadcrumb={
        openDevice ? (
          <button
            type="button"
            onClick={() => setOpenDevice(null)}
            className="inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-sm text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-4 focus-visible:ring-ring/50"
          >
            <RiArrowLeftSLine size={15} aria-hidden />
            Диапазоны сетей
          </button>
        ) : (
          // Раздел у отчёта не по адресу, а по меню: сети — часть мониторинга
          <Crumbs section="mikrotik" />
        )
      }
      toolbar={
        openDevice ? null : (
          <>
            <SearchBar
              value={search}
              onChange={changeSearch}
              placeholder="Адрес, сеть, интерфейс, устройство…"
              className="w-full md:w-72"
            />
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => exportNetworksToExcel(visibleEntries)}
            >
              <RiDownloadLine /> Выгрузить
            </Button>
          </>
        )
      }
    >
      {openDevice ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {drilledEntries.map((entry) => (
            <NetworkAddressRow key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <>
          <NetworksStrip
            counts={counts}
            selected={kinds}
            onToggle={toggleKind}
            disabledCount={totals.disabled}
            showDisabled={showDisabled}
            onToggleDisabled={() => setShowDisabled((current) => !current)}
          />

          {visibleOverlaps.length > 0 && (
            <>
              <Eyebrow count={visibleOverlaps.length}>Пересечения</Eyebrow>
              <NetworksOverlaps overlaps={visibleOverlaps} />
            </>
          )}

          <Eyebrow count={visibleEntries.length}>
            {narrowed ? "Найденные адреса" : "Все адреса"}
          </Eyebrow>

          {visibleEntries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
              <p className="my-0 text-muted-foreground">
                Ничего не нашлось. Измените запрос или сбросьте фильтры.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setSearch("");
                  setKinds([]);
                }}
              >
                Сбросить фильтры
              </Button>
            </div>
          ) : (
            <>
              <BrowserView>
                <NetworksTable
                  entries={visibleEntries}
                  sort={sort}
                  onSort={setSort}
                />
              </BrowserView>
              <MobileView>
                {/* Пока идёт поиск, ось «устройство» не отвечает на заданный
                    вопрос — drill-down схлопывается в плоский список. */}
                {terms.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {visibleEntries.map((entry) => (
                      <NetworkAddressRow
                        key={entry.id}
                        entry={entry}
                        withDevice
                      />
                    ))}
                  </div>
                ) : (
                  <NetworksDeviceList
                    devices={devices}
                    onOpen={setOpenDevice}
                  />
                )}
              </MobileView>
            </>
          )}
        </>
      )}
    </PageShell>
  );
};

export default Networks;

export async function loader() {
  document.title = "Диапазоны сетей";

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/report/networks`,
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

import { useEffect } from "react";

import { RiErrorWarningLine, RiExternalLinkLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import { formatShortDate } from "../../util/format-date";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

export const BRANCH_LABEL = {
  "7.stable": "stable",
  "7.long-term": "long-term",
  "6.stable": "stable (v6)",
  "6.long-term": "long-term (v6)",
};
const BRANCH_ORDER = ["7.stable", "7.long-term", "6.stable", "6.long-term"];

const CHANGELOGS_URL = "https://mikrotik.com/download/changelogs";

// Полоса «последние версии RouterOS» над списком — сводка и фильтр
// одновременно (канон «сводка = переключатель», как лента парка и очереди):
// чип ветки несёт её последнюю версию и число отстающих устройств, клик сужает
// список до этих устройств (фасет `branch` стора). Ветка, где все актуальны, —
// справка без клика: сужать нечего, а версия всё равно полезна. Чипы v7 —
// всегда, v6 — только когда во флоте есть такие устройства. Чейнджлоги —
// ссылкой на mikrotik.com в хвосте полосы: шторка с текстом чейнджлога снята
// 08.09 — чип, который выглядит фильтром, обязан фильтровать. Пустой кэш
// (первый деплой до boot-рефреша) — полоса не рендерится вовсе.
//
// На телефоне (макет 28.09) полоса — блок: строка «RouterOS» + `mobileAside`
// (ссылка «Диапазоны сетей», на десктопе она стоит справа от полосы у
// страницы), под ней чипы плитками в сетке 2×N — чипы в ряд сжимались и
// переносили подпись внутри пилюли. Без релизов остаётся одна ссылка.
const RouterOsStrip = ({ mobileAside = null }) => {
  const releases = useMikrotikDeviceFilterStore((state) => state.releases);
  const fetchReleases = useMikrotikDeviceFilterStore(
    (state) => state.fetchReleases,
  );
  const originalList = useMikrotikDeviceFilterStore(
    (state) => state.originalList,
  );
  const branch = useMikrotikDeviceFilterStore((state) => state.facets.branch);
  const setFacet = useMikrotikDeviceFilterStore((state) => state.setFacet);

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);

  const channels = releases?.channels || [];
  const byKey = new Map(channels.map((channel) => [channel.key, channel]));

  const fleetBranches = new Set(
    (originalList || [])
      .map((row) => row.firmwareStatus?.branchKey)
      .filter(Boolean),
  );

  const visible = BRANCH_ORDER.filter((key) => {
    if (!byKey.get(key)?.version) return false;
    return key.startsWith("6.") ? fleetBranches.has(key) : true;
  });
  if (!visible.length) {
    return mobileAside ? (
      <div className="flex justify-end md:hidden">{mobileAside}</div>
    ) : null;
  }

  // Число на чипе — ровно те строки, до которых он сужает список
  const behindCount = (key) =>
    (originalList || []).filter(
      (row) =>
        row.firmwareStatus?.branchKey === key &&
        row.firmwareStatus.updateAvailable,
    ).length;

  const newestFetch = channels.reduce(
    (max, channel) =>
      channel.fetchedAt && (!max || channel.fetchedAt > max)
        ? channel.fetchedAt
        : max,
    null,
  );
  const hasError =
    channels.some((channel) => channel.lastError) ||
    Boolean(releases?.cveSync?.lastError);

  const errorIcon = hasError && (
    <RiErrorWarningLine
      aria-hidden
      className="text-warning"
      title="Не удалось обновить данные о версиях или уязвимостях — показаны сохранённые."
    />
  );

  // Чип на телефоне — плитка: версия над счётчиком, ширина — ячейка сетки
  const tileClass =
    "max-md:h-auto max-md:min-w-0 max-md:flex-col max-md:items-start max-md:gap-0 max-md:rounded-xl max-md:px-3 max-md:py-2 max-md:text-left";

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1 text-sm text-faint max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:px-0">
      {/* Заголовок блока: на десктопе растворяется в ряд (contents), на
          телефоне — отдельная строка на обе колонки с ссылкой справа */}
      <div className="flex items-center gap-2.5 max-md:col-span-2 max-md:px-0.5 md:contents">
        <span className="text-xs font-bold tracking-wider uppercase">
          RouterOS
        </span>
        <span className="md:hidden">{errorIcon}</span>
        {mobileAside && (
          <span className="ms-auto md:hidden">{mobileAside}</span>
        )}
      </div>
      {visible.map((key) => {
        const channel = byKey.get(key);
        const behind = behindCount(key);
        const active = branch === key;
        const version = (
          <span className="font-mono font-semibold text-foreground max-md:block max-md:max-w-full max-md:truncate">
            {BRANCH_LABEL[key]} {channel.version}
          </span>
        );
        // Выбранная ветка остаётся чипом-переключателем, даже если отстающих
        // уже нет — иначе выбор исчезал бы из-под пальца
        if (!behind && !active) {
          return (
            <span
              key={key}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm text-muted-foreground",
                tileClass,
              )}
            >
              {version}
              <span className="text-faint max-md:text-xs">все актуальны</span>
            </span>
          );
        }
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            title="Показать отстающие устройства ветки"
            onClick={() => setFacet("branch", active ? null : key)}
            className={cn(
              "inline-flex h-8 cursor-pointer appearance-none items-center gap-2 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
              active
                ? "border-input bg-accent text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent",
              tileClass,
            )}
          >
            {version}
            <span className="font-semibold text-warning tabular-nums max-md:text-xs">
              отстают {behind}
              {/* На телефоне плитка не похожа на чип — стрелка говорит «жми» */}
              <span
                aria-hidden
                className="ms-1 font-normal text-faint md:hidden"
              >
                ›
              </span>
            </span>
          </button>
        );
      })}
      {errorIcon && <span className="max-md:hidden">{errorIcon}</span>}
      <span className="ms-auto hidden items-center gap-1 text-xs md:inline-flex">
        {newestFetch && (
          <>релизы и CVE-база — от {formatShortDate(newestFetch)} ·</>
        )}
        <a
          href={CHANGELOGS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-accent-text no-underline hover:underline"
        >
          changelog <RiExternalLinkLine size={12} aria-hidden />
        </a>
      </span>
    </div>
  );
};

export default RouterOsStrip;

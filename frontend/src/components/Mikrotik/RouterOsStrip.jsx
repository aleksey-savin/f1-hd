import { useEffect, useState } from "react";

import { RiErrorWarningLine, RiExternalLinkLine } from "react-icons/ri";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { formatDate, formatShortDate } from "../../util/format-date";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const BRANCH_LABEL = {
  "7.stable": "stable",
  "7.long-term": "long-term",
  "6.stable": "stable (v6)",
  "6.long-term": "long-term (v6)",
};
const BRANCH_ORDER = ["7.stable", "7.long-term", "6.stable", "6.long-term"];

// Полоса «последние версии RouterOS» над списком: чипы веток с числом
// отстающих устройств + свежесть релизов и CVE-базы. Чипы v7 — всегда, v6 —
// только когда во флоте есть такие устройства. Клик по чипу — правая шторка с
// датой выхода, статистикой ветки и чейнджлогом. Пустой кэш (первый деплой до
// boot-рефреша) — полоса не рендерится вовсе.
const RouterOsStrip = () => {
  const releases = useMikrotikDeviceFilterStore((state) => state.releases);
  const fetchReleases = useMikrotikDeviceFilterStore(
    (state) => state.fetchReleases,
  );
  const originalList = useMikrotikDeviceFilterStore(
    (state) => state.originalList,
  );

  const [openKey, setOpenKey] = useState(null);

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
  if (!visible.length) return null;

  const branchStats = (key) => {
    const rows = (originalList || []).filter(
      (row) => row.firmwareStatus?.branchKey === key,
    );
    return {
      total: rows.length,
      behind: rows.filter((row) => row.firmwareStatus.updateAvailable).length,
    };
  };

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

  const open = openKey ? byKey.get(openKey) : null;
  const openStats = openKey ? branchStats(openKey) : null;

  return (
    <>
      {/* Нижний отступ ряда задаёт обёртка topContent страницы списка */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1 text-sm text-faint">
        <span className="text-xs font-bold tracking-wider uppercase">
          RouterOS
        </span>
        {visible.map((key) => {
          const channel = byKey.get(key);
          const { behind } = branchStats(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setOpenKey(key)}
              className="inline-flex h-8 cursor-pointer appearance-none items-center gap-2 rounded-full border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              <span className="font-mono font-semibold text-foreground">
                {BRANCH_LABEL[key]} {channel.version}
              </span>
              {behind > 0 ? (
                <span className="font-semibold text-warning tabular-nums">
                  отстают {behind}
                </span>
              ) : (
                <span className="text-faint">все актуальны</span>
              )}
            </button>
          );
        })}
        {hasError && (
          <RiErrorWarningLine
            aria-hidden
            className="text-warning"
            title="Не удалось обновить данные о версиях или уязвимостях — показаны сохранённые."
          />
        )}
        {newestFetch && (
          <span className="ms-auto hidden text-xs md:block">
            релизы и CVE-база — от {formatShortDate(newestFetch)}
          </span>
        )}
      </div>

      <Sheet
        open={Boolean(open)}
        onOpenChange={(next) => {
          if (!next) setOpenKey(null);
        }}
      >
        <SheetContent side="right" className="w-11/12 max-w-md">
          {open && (
            <>
              <div className="border-b border-border-soft px-5 pt-4 pb-3.5">
                <SheetTitle className="my-0 pr-8 text-lg font-semibold">
                  RouterOS <span className="font-mono">{open.version}</span>{" "}
                  <span className="text-muted-foreground">
                    · {BRANCH_LABEL[openKey]}
                  </span>
                </SheetTitle>
                <div className="mt-1 text-sm text-muted-foreground">
                  {open.releasedAt && (
                    <>Вышла {formatDate(open.releasedAt)} · </>
                  )}
                  {openStats?.total > 0 ? (
                    <>
                      устройств на ветке: {openStats.total}
                      {openStats.behind > 0
                        ? ` · отстают: ${openStats.behind}`
                        : " · все на последней версии"}
                    </>
                  ) : (
                    "устройств на этой ветке нет"
                  )}
                </div>
                <a
                  href="https://mikrotik.com/download/changelogs"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-accent-text no-underline hover:underline"
                >
                  Открыть на mikrotik.com{" "}
                  <RiExternalLinkLine size={13} aria-hidden />
                </a>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {open.changelog ? (
                  <pre className="my-0 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {open.changelog}
                  </pre>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Чейнджлог недоступен.
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
};

export default RouterOsStrip;

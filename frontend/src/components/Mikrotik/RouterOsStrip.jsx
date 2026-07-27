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
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-1.5 tw:px-1 tw:text-sm tw:text-faint">
        <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:uppercase">
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
              className="tw:inline-flex tw:h-8 tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-border tw:bg-card tw:px-3 tw:text-sm tw:text-muted-foreground tw:transition-colors tw:hover:bg-accent"
            >
              <span className="tw:font-mono tw:font-semibold tw:text-foreground">
                {BRANCH_LABEL[key]} {channel.version}
              </span>
              {behind > 0 ? (
                <span className="tw:font-semibold tw:text-warning tw:tabular-nums">
                  отстают {behind}
                </span>
              ) : (
                <span className="tw:text-faint">все актуальны</span>
              )}
            </button>
          );
        })}
        {hasError && (
          <RiErrorWarningLine
            aria-hidden
            className="tw:text-warning"
            title="Не удалось обновить данные о версиях или уязвимостях — показаны сохранённые."
          />
        )}
        {newestFetch && (
          <span className="tw:ms-auto tw:hidden tw:text-xs tw:md:block">
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
        <SheetContent side="right" className="tw:w-11/12 tw:max-w-md">
          {open && (
            <>
              <div className="tw:border-b tw:border-border-soft tw:px-5 tw:pt-4 tw:pb-3.5">
                <SheetTitle className="tw:my-0 tw:pr-8 tw:text-lg tw:font-semibold">
                  RouterOS <span className="tw:font-mono">{open.version}</span>{" "}
                  <span className="tw:text-muted-foreground">
                    · {BRANCH_LABEL[openKey]}
                  </span>
                </SheetTitle>
                <div className="tw:mt-1 tw:text-sm tw:text-muted-foreground">
                  {open.releasedAt && <>Вышла {formatDate(open.releasedAt)} · </>}
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
                  className="tw:mt-1.5 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-semibold tw:text-accent-text tw:no-underline tw:hover:underline"
                >
                  Открыть на mikrotik.com{" "}
                  <RiExternalLinkLine size={13} aria-hidden />
                </a>
              </div>
              <div className="tw:flex-1 tw:overflow-y-auto tw:px-5 tw:py-4">
                {open.changelog ? (
                  <pre className="tw:my-0 tw:font-mono tw:text-xs tw:leading-relaxed tw:whitespace-pre-wrap tw:text-muted-foreground">
                    {open.changelog}
                  </pre>
                ) : (
                  <div className="tw:text-sm tw:text-muted-foreground">
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

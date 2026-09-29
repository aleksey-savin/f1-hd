import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  RiArrowUpCircleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiLoader4Line,
  RiShieldFlashLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Panel, Eyebrow } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import { cn } from "@/lib/utils";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { formatDate } from "../../util/format-date";
import FixCommand from "./FixCommand";
import UpgradeDialog from "./UpgradeDialog";
import UpgradeSheet from "./UpgradeSheet";
import {
  VISIBLE_STEPS,
  branchTargets,
  stepIndex,
  stepPhrase,
  versionLine,
} from "./upgrade-format.js";
import useUpgradeClock from "./use-upgrade-clock.js";

const StepBar = ({ current }) => (
  <div className="mt-3.5 flex items-start">
    {VISIBLE_STEPS.map((label, index) => (
      <div
        key={label}
        className="relative flex flex-1 flex-col items-start gap-1.5 last:flex-none"
      >
        {index < VISIBLE_STEPS.length - 1 && (
          <span
            aria-hidden
            className={cn(
              "absolute top-[7px] right-1 left-5 h-0.5 rounded-full",
              index < current ? "bg-primary" : "bg-border",
            )}
          />
        )}
        <span
          className={cn(
            "relative z-10 grid size-4 place-items-center rounded-full",
            index < current && "bg-primary text-primary-foreground",
            index === current && "border-2 border-info bg-card",
            index > current && "border-2 border-border bg-card",
          )}
        >
          {index < current && <RiCheckLine size={10} />}
        </span>
        <span
          className={cn(
            "pe-2 text-xs",
            index === current
              ? "font-semibold text-foreground"
              : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </div>
    ))}
  </div>
);

// Секция «Прошивка и безопасность» страницы записи (макет, экраны 5–6):
// версии и CVE как раньше, плюс обновление из HD — ветка (текущая отмечена,
// откат погашен), «Обновить до X», ход, результат, ошибка с командой, или
// подсказка включить обновление в параметрах. Без права — только версии и CVE.
const FirmwareSection = ({ row, canUpgrade, canManage }) => {
  const releases = useMikrotikDeviceFilterStore((state) => state.releases);
  const fetchReleases = useMikrotikDeviceFilterStore(
    (state) => state.fetchReleases,
  );
  const currentUpgrade = useMikrotikDeviceFilterStore(
    (state) => state.currentUpgrade,
  );
  const fetchCurrentUpgrade = useMikrotikDeviceFilterStore(
    (state) => state.fetchCurrentUpgrade,
  );

  const firmware = row.firmwareStatus;
  const upgrade = row.upgrade;
  const last = row.lastUpgrade;
  const inBatch = upgrade?.state === "running" || upgrade?.state === "queued";

  const targets = branchTargets({ firmwareStatus: firmware, releases });
  const [channel, setChannel] = useState(
    firmware?.channel === "stable" ? "stable" : "long-term",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const now = useUpgradeClock(upgrade?.state === "running");

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);
  // Идущий пакет нужен и вне пакета: пока идёт другой, «Обновить до X» гасится.
  // Пульс (row.pulse) двигается и на шагах пакета — держит его свежим.
  useEffect(() => {
    fetchCurrentUpgrade();
  }, [fetchCurrentUpgrade, inBatch, upgrade?.step, row.pulse]);
  // Пакет закончился — шторка не должна всплыть сама на следующем.
  useEffect(() => {
    if (!inBatch) setSheetOpen(false);
  }, [inBatch]);

  // Во время обновления заголовок показывает переход «с → на» (макет, экран 6).
  const runningItem = currentUpgrade?.items?.find(
    (item) => String(item.recordId) === String(row.recordId),
  );
  const heading =
    upgrade?.state === "running" && runningItem?.from?.os && runningItem?.to?.os
      ? `RouterOS ${runningItem.from.os} → ${runningItem.to.os}`
      : `RouterOS ${firmware?.installedVersion || row.currentFirmware || "—"}`;

  const target = targets.find((entry) => entry.channel === channel);
  // Идёт чужой пакет (это устройство не в нём): сервер ответит 409 — не даём
  // дойти до него.
  const otherUpgradeRunning = Boolean(currentUpgrade) && !inBatch;
  const canStart =
    canUpgrade &&
    upgrade?.enabled &&
    !inBatch &&
    !otherUpgradeRunning &&
    target?.version &&
    !target.downgrade &&
    !target.upToDate;
  const offline = row.status !== "online" || !row.monitoringEnabled;

  // Стабильный список для диалога: новый `[id]` на каждом рендере (тихая
  // ревалидация по пульсу) перезапускал бы его эффект плана.
  const recordIds = useMemo(() => [row.recordId], [row.recordId]);

  const segmentOptions = targets.map((entry) => ({
    value: entry.channel,
    label: entry.current ? `${entry.channel} · текущая` : entry.channel,
    disabled: entry.downgrade,
    title: entry.downgrade
      ? `Это откат с ${firmware.installedVersion} на ${entry.version} — из HD не делается`
      : undefined,
  }));

  const controls = canUpgrade &&
    upgrade?.enabled &&
    !inBatch &&
    targets.length > 0 && (
      <>
        <div className="mt-3 flex flex-wrap items-center gap-3.5 border-t border-border pt-3.5 max-md:flex-col max-md:items-stretch">
          <Segmented
            options={segmentOptions}
            value={channel}
            onChange={setChannel}
            ariaLabel="Ветка RouterOS"
            fit
          />
          {target?.version && (
            <span className="font-mono text-sm text-muted-foreground max-md:hidden">
              {firmware.installedVersion} → {target.version}
            </span>
          )}
          <span className="flex-1 max-md:hidden" />
          <Button
            onClick={() => setDialogOpen(true)}
            disabled={!canStart || offline}
            title={
              otherUpgradeRunning
                ? "Идёт другое обновление — дождитесь его окончания"
                : offline
                  ? "Устройство не в сети"
                  : target?.upToDate
                    ? "Уже актуальная версия ветки"
                    : undefined
            }
          >
            <RiArrowUpCircleLine />
            {target?.version ? `Обновить до ${target.version}` : "Обновить"}
          </Button>
        </div>
        {target && !target.current ? (
          <div className="mt-2 text-xs text-warning">
            Устройство перейдёт на ветку {target.channel} и дальше будет
            получать её версии. Вернуться обратно из HD не получится: это откат,
            его делают вручную.
          </div>
        ) : (
          <div className="mt-2 text-xs text-faint">
            RouterBOOT обновится следом · две перезагрузки, около 5 минут ·
            перед обновлением сохраним копию конфигурации
          </div>
        )}
        <UpgradeDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          recordIds={recordIds}
          channel={channel}
          lockChannel
          singleName={row.displayName}
          onStarted={() => fetchCurrentUpgrade()}
        />
      </>
    );

  return (
    <>
      <Eyebrow id="firmware">Прошивка и безопасность</Eyebrow>
      <Panel>
        <div className="text-base">
          <span className="font-mono font-semibold">{heading}</span>
          {firmware?.channel && (
            <span className="text-faint"> · ветка {firmware.channel}</span>
          )}
        </div>

        {inBatch ? (
          <>
            <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-info-text">
              <RiLoader4Line size={15} className="animate-spin" aria-hidden />
              {upgrade.state === "queued"
                ? "В очереди пакета обновления"
                : `Обновляется · ${stepPhrase(upgrade, now)}`}
            </div>
            <StepBar
              current={
                upgrade.state === "queued" ? -1 : stepIndex(upgrade.step)
              }
            />
            <div className="mt-3.5 text-xs text-faint">
              {currentUpgrade
                ? `В пакете из ${currentUpgrade.counts.total} · запустил ${currentUpgrade.createdBy?.name || "—"} · `
                : ""}
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs font-semibold text-accent-text hover:underline"
              >
                Ход пакета
              </button>
            </div>
            <UpgradeSheet
              job={currentUpgrade}
              open={sheetOpen && Boolean(currentUpgrade)}
              onOpenChange={setSheetOpen}
              canCancel={canUpgrade}
            />
          </>
        ) : !firmware ? (
          <div className="mt-1.5 text-sm text-faint">
            Версия прошивки ещё не считана.
          </div>
        ) : (
          <>
            {firmware.vulnerable ? (
              <>
                <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-warning">
                  <RiShieldFlashLine size={15} aria-hidden />
                  {firmware.cves.length === 1
                    ? "1 уязвимость"
                    : `Уязвимости: ${firmware.cves.length}`}{" "}
                  · исправлены в {firmware.latestVersion}
                </div>
                <div className="mt-1.5">
                  {firmware.cves.map((cve) => (
                    <div
                      key={cve.id}
                      className="flex items-baseline gap-2.5 border-t border-border-soft py-1.5 text-sm first:border-t-0 max-md:flex-wrap max-md:gap-y-0.5 max-md:py-2"
                    >
                      <span className="flex-none font-mono">{cve.id}</span>
                      <span
                        className={cn(
                          "flex-none font-semibold whitespace-nowrap",
                          cve.score >= 9 ? "text-destructive" : "text-warning",
                        )}
                      >
                        {cve.score} {cve.severity?.toLowerCase()}
                      </span>
                      <span className="min-w-0 text-muted-foreground max-md:line-clamp-2 max-md:basis-full md:truncate">
                        {cve.description}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : firmware.updateAvailable ? (
              <div className="mt-1.5 text-sm text-muted-foreground">
                Доступно обновление до{" "}
                <span className="font-mono font-semibold text-foreground">
                  {firmware.latestVersion}
                </span>{" "}
                ·{" "}
                <a
                  href="https://mikrotik.com/download/changelogs"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent-text no-underline hover:underline"
                >
                  changelog
                </a>
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <RiCheckLine size={15} className="text-primary" aria-hidden />
                Актуальная версия ветки. Известных уязвимостей выше порога из
                настроек нет.
              </div>
            )}

            {last?.state === "done" && !firmware.updateAvailable && (
              <div className="mt-2 text-xs text-faint">
                Обновлено из HD {formatDate(last.finishedAt)}:{" "}
                {versionLine(last)}
                {last.by ? ` · ${last.by}` : ""}
              </div>
            )}

            {last?.state === "failed" && firmware.updateAvailable && (
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <RiErrorWarningLine size={15} aria-hidden />
                  Обновление не удалось {formatDate(last.finishedAt)}
                </div>
                {last.error && <p className="mt-1 text-sm">{last.error}</p>}
                {last.fix && (
                  <div className="mt-2">
                    <FixCommand command={last.fix} />
                  </div>
                )}
              </div>
            )}

            {canUpgrade && !upgrade?.enabled && firmware.updateAvailable && (
              <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-sm text-muted-foreground">
                <RiInformationLine size={15} aria-hidden />
                Обновление из HD для этого устройства выключено.
                {canManage && (
                  <Link
                    to="update"
                    className="font-semibold text-accent-text no-underline hover:underline"
                  >
                    Включить в параметрах подключения
                  </Link>
                )}
              </div>
            )}

            {firmware.updateAvailable && controls}
          </>
        )}
      </Panel>
    </>
  );
};

export default FirmwareSection;

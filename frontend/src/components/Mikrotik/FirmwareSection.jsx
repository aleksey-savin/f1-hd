import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  RiArrowUpCircleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiKey2Line,
  RiLoader4Line,
  RiShieldFlashLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Panel, Eyebrow } from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
import { cn } from "@/lib/utils";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { formatDate, formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import FixCommand from "./FixCommand";
import FoldRow from "./FoldRow";
import { CHR_SPEED } from "./health-flags.js";
import UpgradeDialog from "./UpgradeDialog";
import UpgradeSheet from "./UpgradeSheet";
import {
  VISIBLE_STEPS,
  stepIndex,
  stepPhrase,
  v7Option,
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

// Лицензия секции (макет «Mikrotik: лицензия и копии», 09.10): уровень и срок,
// справа — идентификатор, по которому лицензию ищут в аккаунте MikroTik. Она
// здесь, а не в «Подключении», потому что истёкшая лицензия CHR блокирует
// именно обновление RouterOS. Норма — одна тихая строка свойств; проблема —
// янтарное слово в значении и плашка с объяснением под строками. `null` —
// лицензия ещё не считана, строки нет.
const LICENSE_NOTE = {
  expired:
    "CHR не продлил лицензию в аккаунте MikroTik. Устройство работает, но RouterOS не обновится, пока лицензию не продлят.",
  soon: "Срок близко: устройство не может продлить лицензию в аккаунте MikroTik. Когда срок выйдет, RouterOS перестанет обновляться.",
  chrFree:
    "Бесплатная лицензия CHR: скорость каждого интерфейса ограничена 1 Мбит/с.",
  demo: "Демо-лицензия: RouterOS без ключа работает 24 часа.",
};

// { row, note } — строка свойств и плашка-пояснение (любая может быть null).
const licenseParts = (license) => {
  if (!license) return { row: null, note: null };
  const chr = license.kind === "chr";
  const until = license.until ? formatShortDate(license.until) : null;
  const base = chr
    ? [license.label, CHR_SPEED[license.level]].filter(Boolean).join(" · ")
    : `Level ${license.level}`;

  let tail = null;
  let note = null;
  if (license.state === "expired") {
    tail = until ? `истекла ${until}` : "истекла";
    note = LICENSE_NOTE.expired;
  } else if (license.state === "inactive") {
    tail = "не активна";
    note = chr ? LICENSE_NOTE.chrFree : LICENSE_NOTE.demo;
  } else if (license.soon && until) {
    tail = `до ${until}`;
    note = LICENSE_NOTE.soon;
  }
  const quietTail = tail
    ? null
    : chr
      ? until
        ? `до ${until}`
        : null
      : "бессрочная";

  const id = chr
    ? license.systemId && { label: "System ID", value: license.systemId }
    : license.softwareId && { label: "Software ID", value: license.softwareId };

  return {
    row: (
      <div id="license" className="scroll-mt-28">
        <PropRow
          icon={<RiKey2Line size={17} />}
          label="Лицензия"
          action={
            id ? (
              <span className="flex-none text-end max-md:hidden">
                <span className="block text-xs text-faint">{id.label}</span>
                <span className="block font-mono text-sm font-medium">
                  {id.value}
                </span>
              </span>
            ) : null
          }
          copy={id ? { value: id.value, label: id.label } : undefined}
        >
          {base}
          {quietTail && <span className="text-faint"> · {quietTail}</span>}
          {tail && (
            <span className="font-semibold text-warning max-md:block max-md:text-xs">
              <span className="max-md:hidden"> · </span>
              {tail}
            </span>
          )}
        </PropRow>
      </div>
    ),
    note: note && (
      <div className="mt-1 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm max-md:flex-wrap max-md:text-xs">
        <RiErrorWarningLine
          size={16}
          className="mt-0.5 flex-none text-warning max-md:hidden"
          aria-hidden
        />
        <div className="min-w-0 flex-1 max-md:basis-full">{note}</div>
        {chr && (
          <a
            href="https://mikrotik.com/client"
            target="_blank"
            rel="noreferrer"
            className="flex-none font-semibold whitespace-nowrap text-accent-text no-underline hover:underline"
          >
            Аккаунт MikroTik ↗
          </a>
        )}
      </div>
    ),
  };
};

const CveRow = ({ cve }) => (
  <div className="flex items-baseline gap-2.5 border-t border-border-soft py-1.5 text-sm first:border-t-0 max-md:flex-wrap max-md:gap-y-0.5 max-md:py-2">
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
);

/**
 * Секция «Прошивка и безопасность» страницы записи (макет «Страница устройства
 * Mikrotik», 10.10). В секции — факты и одна кнопка:
 *
 * - шапка: установленная версия с веткой и «Обновить до X» (на последней
 *   шестёрке — «Перейти на RouterOS 7»);
 * - одна строка состояния: уязвимости сводкой (список — под «Показать все»),
 *   доступное обновление или «всё актуально»;
 * - строки свойств, как в «Подключении»: лицензия, последнее обновление из HD,
 *   выключенное обновление из HD.
 *
 * Выбор ветки, путь версий и переход на RouterOS 7 живут в диалоге обновления:
 * раньше они стояли здесь же и делали секцию самой тесной на странице, а
 * диалог умел всё это и так — им обновляют пакет из списка. Идущее обновление
 * заменяет состояние шагами; без права обновлять — только факты.
 */
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

  const v7 = v7Option({
    firmwareStatus: firmware,
    releases,
    totalMemory: row.totalMemory,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const now = useUpgradeClock(upgrade?.state === "running");

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);
  // Идущий пакет нужен и вне пакета: пока идёт другой, кнопка гасится.
  // Пульс (row.pulse) двигается и на шагах пакета — держит его свежим.
  useEffect(() => {
    fetchCurrentUpgrade();
  }, [fetchCurrentUpgrade, inBatch, upgrade?.step, row.pulse]);
  // Пакет закончился — шторка не должна всплыть сама на следующем.
  useEffect(() => {
    if (!inBatch) setSheetOpen(false);
  }, [inBatch]);

  // Во время обновления заголовок показывает переход «с → на».
  const runningItem = currentUpgrade?.items?.find(
    (item) => String(item.recordId) === String(row.recordId),
  );
  const heading =
    upgrade?.state === "running" && runningItem?.from?.os && runningItem?.to?.os
      ? `RouterOS ${runningItem.from.os} → ${runningItem.to.os}`
      : `RouterOS ${firmware?.installedVersion || row.currentFirmware || "—"}`;

  // Своя ветка уже на последней версии: из действий — только переход на 7.
  const branchUpToDate = !firmware?.updateAvailable;
  const currentChannel =
    firmware?.channel === "stable" ? "stable" : "long-term";
  // Последняя шестёрка: дальше — RouterOS 7, диалог откроется с этим флажком.
  const offerV7 = Boolean(firmware && branchUpToDate && v7?.available);
  // Идёт чужой пакет (это устройство не в нём): сервер ответит 409 — не даём
  // дойти до него.
  const otherUpgradeRunning = Boolean(currentUpgrade) && !inBatch;
  const offline = row.status !== "online" || !row.monitoringEnabled;
  const showButton =
    canUpgrade &&
    upgrade?.enabled &&
    !inBatch &&
    Boolean(firmware) &&
    (firmware.updateAvailable || offerV7);
  const blockedReason = otherUpgradeRunning
    ? "Идёт другое обновление — дождитесь его окончания"
    : offline
      ? "Устройство не в сети"
      : undefined;

  // Стабильный список для диалога: новый `[id]` на каждом рендере (тихая
  // ревалидация по пульсу) перезапускал бы его эффект плана.
  const recordIds = useMemo(() => [row.recordId], [row.recordId]);

  const cves = firmware?.vulnerable ? firmware.cves : [];
  // Самая опасная — первой и в сводке
  const sortedCves = [...cves].sort((a, b) => b.score - a.score);
  const worst = sortedCves[0];

  const license = licenseParts(row.license);
  const lastRow = last?.state === "done" && (
    <PropRow
      icon={<RiArrowUpCircleLine size={17} />}
      label="Последнее обновление из HD"
    >
      <span className="tabular-nums">{formatDate(last.finishedAt)}</span> ·{" "}
      <span className="font-mono text-sm">{versionLine(last)}</span>
      {last.by && <span className="text-faint"> · {last.by}</span>}
    </PropRow>
  );
  const disabledRow = canUpgrade &&
    !upgrade?.enabled &&
    firmware?.updateAvailable && (
      <PropRow
        icon={<RiArrowUpCircleLine size={17} />}
        label="Обновление из HD"
      >
        Выключено
        {canManage && (
          <>
            <span className="font-normal"> · </span>
            <Link
              to="update"
              className="font-semibold text-accent-text no-underline hover:underline"
            >
              Включить в параметрах
            </Link>
          </>
        )}
      </PropRow>
    );
  const left = [disabledRow, license.row].filter(Boolean);
  const right = [lastRow].filter(Boolean);
  const hasFacts = left.length + right.length > 0;

  return (
    <>
      <Eyebrow id="firmware">Прошивка и безопасность</Eyebrow>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <div className="font-mono text-lg font-semibold tracking-tight">
            {heading}
            {firmware?.channel && (
              <span className="font-sans text-sm font-normal tracking-normal text-faint">
                {" "}
                · ветка {firmware.channel}
              </span>
            )}
          </div>
          {showButton && (
            <Button
              variant={firmware.updateAvailable ? "default" : "outline"}
              onClick={() => setDialogOpen(true)}
              disabled={Boolean(blockedReason)}
              title={blockedReason}
              className="max-md:w-full"
            >
              <RiArrowUpCircleLine />
              {firmware.updateAvailable
                ? `Обновить до ${firmware.latestVersion}`
                : "Перейти на RouterOS 7"}
            </Button>
          )}
        </div>

        {inBatch ? (
          <>
            <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-info-text">
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
            {/* Запуск со страницы (пакет из одного устройства) — без строки
                про пакет, только ссылка на ход обновления */}
            {currentUpgrade && (
              <div className="mt-3.5 text-xs text-faint">
                {currentUpgrade.counts.total > 1 &&
                  `В пакете из ${currentUpgrade.counts.total} · запустил ${currentUpgrade.createdBy?.name || "—"} · `}
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs font-semibold text-accent-text hover:underline"
                >
                  Ход обновления
                </button>
              </div>
            )}
            <UpgradeSheet
              job={currentUpgrade}
              open={sheetOpen && Boolean(currentUpgrade)}
              onOpenChange={setSheetOpen}
              canCancel={canUpgrade}
            />
          </>
        ) : !firmware ? (
          <div className="mt-2 text-sm text-faint">
            Версия прошивки ещё не считана.
          </div>
        ) : (
          <>
            {last?.state === "failed" && firmware.updateAvailable && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <RiErrorWarningLine size={15} aria-hidden />
                  Обновление не удалось {formatDate(last.finishedAt)}
                </div>
                {last.error && <p className="mt-1 text-sm">{last.error}</p>}
                {last.fix && (
                  <FoldRow
                    summary="Команда, которая это исправляет"
                    label="Показать"
                  >
                    <FixCommand command={last.fix} />
                  </FoldRow>
                )}
              </div>
            )}

            {worst ? (
              <>
                <div className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-warning">
                  <RiShieldFlashLine
                    size={15}
                    aria-hidden
                    className="mt-0.5 flex-none"
                  />
                  <span>
                    {cves.length}{" "}
                    {plural(
                      cves.length,
                      "уязвимость",
                      "уязвимости",
                      "уязвимостей",
                    )}
                    , до {worst.score} {worst.severity?.toLowerCase()} ·{" "}
                    {plural(
                      cves.length,
                      "исправлена",
                      "исправлены",
                      "исправлены",
                    )}{" "}
                    в {firmware.latestVersion}
                  </span>
                </div>
                {/* Одна уязвимость видна сразу; список — под «Показать все» */}
                {cves.length === 1 ? (
                  <div className="mt-1.5">
                    <CveRow cve={worst} />
                  </div>
                ) : (
                  <FoldRow
                    summary={
                      <>
                        Самая опасная:{" "}
                        <span className="font-mono">{worst.id}</span>
                      </>
                    }
                    count={cves.length}
                  >
                    {sortedCves.map((cve) => (
                      <CveRow key={cve.id} cve={cve} />
                    ))}
                  </FoldRow>
                )}
              </>
            ) : firmware.updateAvailable ? (
              <div className="mt-2 text-sm text-muted-foreground">
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
              <div className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                <RiCheckLine
                  size={15}
                  className="mt-0.5 flex-none text-primary"
                  aria-hidden
                />
                <span>
                  {v7
                    ? "Последняя версия RouterOS 6. Новее только RouterOS 7."
                    : "Актуальная версия ветки. Известных уязвимостей выше порога из настроек нет."}
                  {/* Перейти нельзя (мало памяти, объём не считан) — почему */}
                  {v7 && !v7.available && (
                    <span className="block text-xs text-faint">
                      {v7.reason}
                    </span>
                  )}
                </span>
              </div>
            )}
          </>
        )}

        {!inBatch && hasFacts && (
          <div className="mt-3.5 border-t border-border pt-1">
            <div className="grid gap-x-8 md:grid-cols-2">
              <div>{left}</div>
              {/* Телефон: вторая колонка продолжает первую одной чертой */}
              <div
                className={cn(
                  left.length > 0 &&
                    right.length > 0 &&
                    "max-md:border-t max-md:border-border-soft",
                )}
              >
                {right}
              </div>
            </div>
            {license.note}
          </div>
        )}

        {showButton && (
          <UpgradeDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            recordIds={recordIds}
            currentChannel={currentChannel}
            toV7={offerV7}
            singleName={row.displayName}
            onStarted={() => fetchCurrentUpgrade()}
          />
        )}
      </Panel>
    </>
  );
};

export default FirmwareSection;

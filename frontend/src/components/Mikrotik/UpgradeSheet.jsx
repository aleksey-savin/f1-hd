import { useState } from "react";
import { isMobile } from "react-device-detect";
import {
  RiCheckLine,
  RiCheckboxBlankCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { formatTime } from "../../util/format-date";
import { plural } from "../../util/plural";
import FixCommand from "./FixCommand";
import {
  VISIBLE_STEPS,
  WAIT_LIMIT_MS,
  channelModeLabel,
  currentItem,
  formatClock,
  stepIndex,
  versionLine,
} from "./upgrade-format.js";
import useUpgradeClock from "./use-upgrade-clock.js";

const ItemIcon = ({ state }) => {
  if (state === "done")
    return (
      <RiCheckLine size={18} className="text-primary" aria-label="Готово" />
    );
  if (state === "failed")
    return (
      <RiErrorWarningLine
        size={18}
        className="text-destructive"
        aria-label="Ошибка"
      />
    );
  if (state === "running")
    return (
      <RiLoader4Line
        size={18}
        className="animate-spin text-info"
        aria-label="Выполняется"
      />
    );
  return (
    <RiCheckboxBlankCircleLine
      size={14}
      className="text-faint"
      aria-label={state === "skipped" ? "Пропущено" : "В очереди"}
    />
  );
};

const RunningSteps = ({ item, now }) => {
  const current = stepIndex(item.step);
  const waiting = item.step === "wait" || item.step === "routerbootWait";
  return (
    <div className="mt-2 grid gap-0.5">
      {VISIBLE_STEPS.map((label, index) => (
        <div key={label} className="flex min-h-6 items-center gap-2 text-sm">
          <span className="grid size-3.5 flex-none place-items-center">
            {index < current ? (
              <RiCheckLine size={12} className="text-primary" />
            ) : index === current ? (
              <RiLoader4Line size={12} className="animate-spin text-info" />
            ) : (
              <RiCheckboxBlankCircleLine size={10} className="text-faint" />
            )}
          </span>
          <span
            className={cn(
              index < current && "text-muted-foreground",
              index === current && "font-medium",
              index > current && "text-faint",
            )}
          >
            {label}
          </span>
          {index === current && waiting && item.rebootRequestedAt && (
            <span className="text-xs text-faint tabular-nums">
              {formatClock(now - new Date(item.rebootRequestedAt).getTime())} из{" "}
              {formatClock(WAIT_LIMIT_MS)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

// Ход пакета обновления (макет, экраны 4 и «Телефон · 4»): справа на десктопе,
// снизу на телефоне. «Остановить после текущего» не прерывает перезагрузку.
const UpgradeSheet = ({ job, open, onOpenChange, canCancel }) => {
  const cancelUpgrade = useMikrotikDeviceFilterStore(
    (state) => state.cancelUpgrade,
  );
  const fetchCurrentUpgrade = useMikrotikDeviceFilterStore(
    (state) => state.fetchCurrentUpgrade,
  );
  const showToast = useToastStore((state) => state.showToast);
  const [isCancelling, setIsCancelling] = useState(false);
  const running = currentItem(job);
  const now = useUpgradeClock(open && Boolean(running));

  if (!job) return null;
  const { counts } = job;

  const requestCancel = async () => {
    setIsCancelling(true);
    try {
      const response = await cancelUpgrade(job.id);
      const data = await response.json().catch(() => ({}));
      showToast(
        response.ok ? "success" : "danger",
        response.ok
          ? "Остановим после текущего устройства"
          : data.message || "Не удалось остановить пакет",
      );
      fetchCurrentUpgrade();
    } catch {
      showToast("danger", "Не удалось остановить пакет");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile
            ? "max-h-[94dvh] rounded-t-2xl border border-b-0 border-border"
            : "w-full sm:max-w-lg",
        )}
      >
        <div className="border-b border-border px-6 pt-5 pb-4 max-md:px-4">
          <SheetTitle className="text-lg font-semibold">
            Обновление прошивки
          </SheetTitle>
          <SheetDescription className="mt-0.5 text-sm text-muted-foreground">
            {job.createdBy
              ? `Запустил ${job.createdBy.name} в ${formatTime(job.createdAt)} · `
              : ""}
            {channelModeLabel(job.channelMode)}
          </SheetDescription>
          <div className="mt-3.5 flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${counts.total ? (counts.processed / counts.total) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {counts.processed} из {counts.total}
              {counts.done > 0 && ` · ${counts.done} готово`}
              {counts.failed > 0 &&
                ` · ${counts.failed} ${plural(counts.failed, "ошибка", "ошибки", "ошибок")}`}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-1 max-md:px-4">
          {job.items.map((item) => (
            <div
              key={String(item.id)}
              className="flex gap-3 border-t border-border-soft py-3 first:border-t-0"
            >
              <span className="mt-px grid size-5 flex-none place-items-center">
                <ItemIcon state={item.state} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {item.name}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      item.state === "running"
                        ? "font-semibold text-info-text"
                        : "text-faint",
                    )}
                  >
                    {item.state === "running"
                      ? `шаг ${stepIndex(item.step) + 1} из ${VISIBLE_STEPS.length}`
                      : item.state === "queued"
                        ? "в очереди"
                        : item.finishedAt
                          ? formatTime(item.finishedAt)
                          : ""}
                  </span>
                </div>
                {item.state !== "failed" && item.state !== "skipped" && (
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {versionLine(item)}
                  </div>
                )}
                {item.state === "running" && (
                  <RunningSteps item={item} now={now} />
                )}
                {(item.state === "failed" || item.state === "skipped") &&
                  item.error && <p className="mt-1 text-sm">{item.error}</p>}
                {item.state === "failed" && item.fix && (
                  <div className="mt-2">
                    <FixCommand command={item.fix} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {canCancel && job.status === "running" && (
          <div className="flex items-center gap-3 border-t border-border px-6 py-3.5 max-md:flex-col max-md:items-stretch max-md:px-4">
            <span className="flex-1 text-xs text-faint max-md:hidden">
              {running
                ? `${running.name} доведём до конца, остальные не начнутся`
                : ""}
            </span>
            <Button
              variant="outline"
              onClick={requestCancel}
              disabled={Boolean(job.cancelRequestedAt) || isCancelling}
            >
              {job.cancelRequestedAt
                ? "Остановим после текущего"
                : "Остановить после текущего"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default UpgradeSheet;

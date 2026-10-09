import { useEffect, useState } from "react";
import { isMobile } from "react-device-detect";
import { RiErrorWarningLine, RiTimeLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import Segmented from "@/components/app/Segmented";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { displayTimeZone } from "../../util/format-date";
import { plural } from "../../util/plural";
import { quietLabel } from "./activity-format";
import { installsLabel } from "./upgrade-format.js";

const CHANNEL_OPTIONS = [
  { value: "current", label: "Как на устройстве" },
  { value: "long-term", label: "long-term" },
  { value: "stable", label: "stable" },
];

// Сколько строк плана видно на телефоне до «Показать ещё» (макет, экран 2).
const MOBILE_PLAN_LIMIT = 5;

// Оценка времени: обычное устройство — две перезагрузки, около 5 минут;
// переход 6 → 7 — до четырёх и около 20 (макет «Переход с RouterOS 6 на 7»).
const MINUTES_PER_ITEM = 5;
const MINUTES_PER_MAJOR_ITEM = 20;

// Подтверждение обновления прошивки (макет «Обновление прошивки Mikrotik»,
// экраны 2 и «Телефон · 2»): план с сервера — кто и до чего обновится, кто и
// почему пропущен; выбор ветки (по умолчанию — как на устройстве) пересчитывает
// план. Со страницы записи ветка и переход на RouterOS 7 выбраны в секции —
// lockChannel прячет и переключатель, и чекбокс.
const UpgradeDialog = ({
  open,
  onOpenChange,
  recordIds,
  channel: initialChannel = "current",
  toV7: initialToV7 = false,
  lockChannel = false,
  singleName = null,
  onStarted,
}) => {
  const planUpgrade = useMikrotikDeviceFilterStore(
    (state) => state.planUpgrade,
  );
  const startUpgrade = useMikrotikDeviceFilterStore(
    (state) => state.startUpgrade,
  );
  const showToast = useToastStore((state) => state.showToast);

  const [channel, setChannel] = useState(initialChannel);
  const [toV7, setToV7] = useState(initialToV7);
  const [plan, setPlan] = useState(null);
  // Липкий: есть ли среди выбранных устройства на RouterOS 6. План на время
  // пересчёта обнуляется — чекбокс при смене ветки мигать не должен.
  const [hasV6, setHasV6] = useState(false);
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (open) {
      setChannel(initialChannel);
      setToV7(initialToV7);
      setShowAll(false);
    } else {
      // Закрыли — прежний план не должен мигнуть при следующем открытии
      setPlan(null);
      setHasV6(false);
      setError(null);
    }
  }, [open, initialChannel, initialToV7]);

  useEffect(() => {
    if (!open || recordIds.length === 0) return;
    let cancelled = false;
    setPlan(null);
    setError(null);
    (async () => {
      try {
        const response = await planUpgrade(recordIds, channel, toV7);
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(data.message || "Не удалось составить план обновления");
        } else {
          setPlan(data);
          if (data.hasV6) setHasV6(true);
        }
      } catch {
        if (!cancelled) setError("Нет связи с сервером");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channel, toV7, recordIds]);

  const items = plan?.items || [];
  const skipped = plan?.skipped || [];
  const count = items.length;
  const total = count + skipped.length;
  const single = Boolean(singleName);
  // Пока план грузится, в заголовке и на кнопке — сколько выбрали, а не 0
  const shown = plan === null ? recordIds.length : count;
  const majorCount = items.filter((item) => item.majorUpgrade).length;
  const showV7Toggle = !lockChannel && (hasV6 || toV7);
  // Тихое окно — подсказка, когда запускать: одно устройство получает плашку,
  // в пакете — строка под названием. Нет данных — нет и подсказки.
  const zone = displayTimeZone();
  const singleQuiet = single ? items[0]?.quietWindow : null;
  const hasQuiet = !single && items.some((item) => item.quietWindow);

  // План пришёл пустым (все пропущены) — без «на 0 устройствах»; кнопка и так погашена
  const title = single
    ? `Обновить прошивку ${singleName}?`
    : plan !== null && count === 0
      ? "Обновить прошивку?"
      : `Обновить прошивку на ${shown} ${plural(shown, "устройстве", "устройствах", "устройствах")}?`;
  // С переходом на RouterOS 7 «две перезагрузки, 3–5 минут» не обещаем —
  // сроки называет янтарная плашка ниже. Пока план грузится, ориентируемся
  // на отмеченный переход, чтобы текст не мигал между вариантами.
  const expectMajor = majorCount > 0 || (plan === null && toV7);
  const reboots = expectMajor
    ? "."
    : " — это две перезагрузки, связь у клиента пропадёт на 3–5 минут.";
  const description = single
    ? `Перед обновлением HD сохранит копию конфигурации, затем обновит RouterOS и RouterBOOT${reboots}`
    : `Устройства обновятся по очереди. Перед каждым HD сохранит копию конфигурации, затем обновит RouterOS и RouterBOOT${reboots}`;
  const submitLabel =
    single && items[0]
      ? `Обновить до ${items[0].toVersion}`
      : `Обновить ${shown} ${plural(shown, "устройство", "устройства", "устройств")}`;

  const start = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const response = await startUpgrade(recordIds, channel, toV7);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || "Не удалось запустить обновление");
        return;
      }
      showToast("success", "Обновление прошивки запущено");
      onOpenChange(false);
      onStarted?.(data.job);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setIsStarting(false);
    }
  };

  const visibleItems =
    isMobile && !showAll ? items.slice(0, MOBILE_PLAN_LIMIT) : items;

  const body = (
    <div className="grid gap-4">
      {!lockChannel && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <span className="text-sm font-semibold text-muted-foreground">
            Ветка
          </span>
          <Segmented
            options={CHANNEL_OPTIONS}
            value={channel}
            onChange={setChannel}
            ariaLabel="Ветка RouterOS"
            fit
            className="max-md:w-full"
          />
        </div>
      )}

      {showV7Toggle && (
        <label className="flex cursor-pointer items-start gap-2.5">
          <Checkbox
            checked={toV7}
            onCheckedChange={(value) => setToV7(value === true)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              Перейти на RouterOS 7
            </span>
            <span className="text-xs text-faint">
              {isMobile
                ? "Для устройств на RouterOS 6"
                : "Для устройств на RouterOS 6: сначала до 6.49.22, затем на RouterOS 7 в выбранной ветке."}
            </span>
          </span>
        </label>
      )}

      {plan === null && !error && (
        <div className="text-sm text-muted-foreground">Составляем план…</div>
      )}

      {count > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          {visibleItems.map((item) => (
            <div
              key={String(item.recordId)}
              className="flex min-h-10 items-center gap-3 border-t border-border-soft px-3.5 py-1.5 text-sm first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.name}</span>
                {item.majorUpgrade && (
                  <span className="block text-xs text-faint">
                    через {item.via.join(" и ")}
                    <span className="max-md:hidden">
                      {" "}
                      · {installsLabel(item.legs.length)}
                    </span>
                  </span>
                )}
                {!single && item.quietWindow && (
                  <span
                    className={cn(
                      "block text-xs tabular-nums",
                      item.quietWindow.current
                        ? "font-medium text-accent-text"
                        : "text-muted-foreground",
                    )}
                  >
                    {item.quietWindow.current ? "тихо сейчас, " : "тихо "}
                    {quietLabel(item.quietWindow, zone)}
                  </span>
                )}
              </span>
              <span className="font-mono text-sm max-md:text-xs">
                {item.fromVersion} → {item.toVersion}
              </span>
              <span className="w-18 flex-none text-right text-xs text-faint max-md:hidden">
                {item.channel}
              </span>
            </div>
          ))}
          {visibleItems.length < items.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="flex h-10 w-full cursor-pointer appearance-none items-center border-0 border-t border-border-soft bg-transparent px-3.5 text-sm font-semibold text-accent-text"
            >
              Показать ещё {items.length - visibleItems.length}
            </button>
          )}
        </div>
      )}

      {hasQuiet && (
        <p className="-mt-2 text-xs text-faint">
          Тихие часы — время наименьшей сетевой активности устройства.
        </p>
      )}

      {singleQuiet && (
        <div
          className={cn(
            "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
            singleQuiet.current
              ? "border-primary/35 bg-primary/5"
              : "border-border bg-muted",
          )}
        >
          <RiTimeLine
            size={16}
            aria-hidden
            className={cn(
              "mt-0.5 flex-none",
              singleQuiet.current ? "text-accent-text" : "text-muted-foreground",
            )}
          />
          <div>
            {singleQuiet.current ? (
              <>
                Сейчас подходящее время:{" "}
                <b className="font-semibold tabular-nums">
                  {quietLabel(singleQuiet, zone)}
                </b>{" "}
                на устройстве наименьшая сетевая активность.
              </>
            ) : (
              <>
                Рекомендуем обновить{" "}
                <b className="font-semibold tabular-nums">
                  {quietLabel(singleQuiet, zone).replace(
                    / (\d\d:\d\d)–/,
                    " с $1 до ",
                  )}
                </b>
                : в это время на устройстве наименьшая сетевая активность.
              </>
            )}
          </div>
        </div>
      )}

      {skipped.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-warning">
            <RiErrorWarningLine size={15} aria-hidden />
            Пропустим {skipped.length} из {total}
          </div>
          {skipped.map((entry) => (
            <p
              key={String(entry.recordId)}
              className="mt-1 text-sm text-muted-foreground"
            >
              {entry.name} — {entry.reason}
            </p>
          ))}
        </div>
      )}

      {majorCount > 0 &&
        (isMobile ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs">
            Переход на RouterOS 7: до четырёх перезагрузок, около 20 минут на
            устройство, конфигурация конвертируется автоматически. Вернуть на
            RouterOS 6 из HD нельзя.
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
            <RiErrorWarningLine
              size={16}
              className="mt-0.5 flex-none text-warning"
              aria-hidden
            />
            <div>
              Переход на RouterOS 7 — большое обновление: до четырёх
              перезагрузок и около 20 минут на устройство. Конфигурация
              конвертируется автоматически — после проверьте маршрутизацию
              (OSPF, BGP). Вернуть устройство на RouterOS 6 из HD нельзя.
            </div>
          </div>
        ))}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );

  const minutes = Math.max(
    MINUTES_PER_ITEM,
    majorCount * MINUTES_PER_MAJOR_ITEM + (count - majorCount) * MINUTES_PER_ITEM,
  );
  const estimate = `Около ${minutes} минут. Страницу можно закрыть — HD продолжит сам.`;

  const actions = (
    <>
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        className="max-md:w-full"
      >
        Отмена
      </Button>
      <Button
        onClick={start}
        disabled={count === 0 || isStarting}
        className="max-md:order-first max-md:w-full"
      >
        {isStarting ? "Запускаем…" : submitLabel}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] gap-4 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-4 pb-6"
        >
          <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            {description}
          </SheetDescription>
          {body}
          <div className="flex flex-col gap-2">{actions}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-xs text-faint">{estimate}</span>
          <div className="flex gap-2">{actions}</div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeDialog;

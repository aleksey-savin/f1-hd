import { useEffect, useState } from "react";
import { isMobile } from "react-device-detect";
import { RiErrorWarningLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
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
import useToastStore from "@/store/toast-store";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { plural } from "../../util/plural";

const CHANNEL_OPTIONS = [
  { value: "current", label: "Как на устройстве" },
  { value: "long-term", label: "long-term" },
  { value: "stable", label: "stable" },
];

// Сколько строк плана видно на телефоне до «Показать ещё» (макет, экран 2).
const MOBILE_PLAN_LIMIT = 5;

// Подтверждение обновления прошивки (макет «Обновление прошивки Mikrotik»,
// экраны 2 и «Телефон · 2»): план с сервера — кто и до чего обновится, кто и
// почему пропущен; выбор ветки (по умолчанию — как на устройстве) пересчитывает
// план. Со страницы записи ветка выбрана в секции — lockChannel прячет выбор.
const UpgradeDialog = ({
  open,
  onOpenChange,
  recordIds,
  channel: initialChannel = "current",
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
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (open) {
      setChannel(initialChannel);
      setShowAll(false);
    } else {
      // Закрыли — прежний план не должен мигнуть при следующем открытии
      setPlan(null);
      setError(null);
    }
  }, [open, initialChannel]);

  useEffect(() => {
    if (!open || recordIds.length === 0) return;
    let cancelled = false;
    setPlan(null);
    setError(null);
    (async () => {
      try {
        const response = await planUpgrade(recordIds, channel);
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok)
          setError(data.message || "Не удалось составить план обновления");
        else setPlan(data);
      } catch {
        if (!cancelled) setError("Нет связи с сервером");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channel, recordIds]);

  const items = plan?.items || [];
  const skipped = plan?.skipped || [];
  const count = items.length;
  const total = count + skipped.length;
  const single = Boolean(singleName);
  // Пока план грузится, в заголовке и на кнопке — сколько выбрали, а не 0
  const shown = plan === null ? recordIds.length : count;

  // План пришёл пустым (все пропущены) — без «на 0 устройствах»; кнопка и так погашена
  const title = single
    ? `Обновить прошивку ${singleName}?`
    : plan !== null && count === 0
      ? "Обновить прошивку?"
      : `Обновить прошивку на ${shown} ${plural(shown, "устройстве", "устройствах", "устройствах")}?`;
  const description = single
    ? "Перед обновлением HD сохранит копию конфигурации, затем обновит RouterOS и RouterBOOT — это две перезагрузки, связь у клиента пропадёт на 3–5 минут."
    : "Устройства обновятся по очереди. Перед каждым HD сохранит копию конфигурации, затем обновит RouterOS и RouterBOOT — это две перезагрузки, связь у клиента пропадёт на 3–5 минут.";
  const submitLabel =
    single && items[0]
      ? `Обновить до ${items[0].toVersion}`
      : `Обновить ${shown} ${plural(shown, "устройство", "устройства", "устройств")}`;

  const start = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const response = await startUpgrade(recordIds, channel);
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

      {plan === null && !error && (
        <div className="text-sm text-muted-foreground">Составляем план…</div>
      )}

      {count > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          {visibleItems.map((item) => (
            <div
              key={String(item.recordId)}
              className="flex h-10 items-center gap-3 border-t border-border-soft px-3.5 text-sm first:border-t-0"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {item.name}
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

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );

  const estimate = `Около ${Math.max(5, count * 5)} минут. Страницу можно закрыть — HD продолжит сам.`;

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

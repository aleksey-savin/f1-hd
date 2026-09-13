import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  RiAlertLine,
  RiArrowRightSLine,
  RiPulseLine,
  RiRefreshLine,
  RiShieldFlashLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { DeviceStatusText } from "@/components/app/device-status";
import Spinner from "@/components/app/Spinner";
import useLiveTopic from "@/hooks/use-live-topic";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { formatDate } from "../../util/format-date";

// Одна величина — одна плитка; подписи короткие, значения крупные.
const Stat = ({ label, children }) => (
  <div className="min-w-24">
    <div className="text-xs text-faint">{label}</div>
    <div className="mt-0.5 text-base font-semibold tabular-nums">
      {children}
    </div>
  </div>
);

/**
 * Мониторинг Mikrotik на карточке устройства — СВОДКА, а не раздел: связь,
 * доступность, прошивка, уязвимости, последняя связь и ссылка на страницу
 * записи. Полный мониторинг (лента доступности, журнал простоев, конфигурации,
 * CVE-список) живёт в своём разделе — второй его копии здесь не бывает.
 *
 * Данные — record-центричная ручка `GET /mikrotik-devices/records/:recordId`
 * (та же, что у страницы записи), поэтому карточка не заводит своего формата.
 * Устройству управляемого вендора без записи показывается вход в подключение:
 * форма «Новое устройство» раздела мониторинга, привязанная к этой карточке.
 */
const MonitoringPanel = ({ device, canManage, onSynced }) => {
  const recordId = device.mikrotik?.recordId || null;
  const [row, setRow] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(recordId));
  const syncInventory = useMikrotikDeviceFilterStore(
    (state) => state.syncInventory,
  );
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    setIsLoading(true);
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/records/${recordId}`,
      {},
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        setRow(data);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  // Роутер упал или поднялся, пока карточка открыта — тихо перечитываем по
  // пульсу (docs/live-updates.md); раз в 5 минут — в любом случае, «последняя
  // связь» течёт и без событий
  useLiveTopic(
    "mikrotik",
    async () => {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/records/${recordId}`,
      );
      if (response.ok) setRow(await response.json());
    },
    { enabled: Boolean(recordId) && !isLoading, maxStaleMs: 5 * 60_000 },
  );

  // Не подключено: вход в подключение — в разделе мониторинга, форма
  // «Новое устройство» с привязкой к этой инвентарной карточке.
  if (!recordId) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-5 py-7 text-center">
        <RiPulseLine size={34} aria-hidden className="mb-1 text-faint" />
        <div className="text-base font-semibold">
          Устройство не подключено к мониторингу
        </div>
        <p className="my-0 max-w-md text-sm text-muted-foreground">
          Подключение проверит доступ по API, включит проверки связи каждые 5
          минут и хранение копий конфигурации.
        </p>
        {canManage ? (
          <Button asChild variant="outline" className="mt-3">
            <Link to={`/devices/mikrotik/add?clientDeviceId=${device._id}`}>
              Подключить к мониторингу
            </Link>
          </Button>
        ) : (
          <div className="mt-2 text-sm text-faint">
            Недостаточно прав — обратитесь к администратору.
          </div>
        )}
      </div>
    );
  }

  if (isLoading && !row) return <Spinner className="min-h-24" />;

  const monitoringOff = row ? row.monitoringEnabled === false : false;
  const online = row?.status === "online";
  const firmware = row?.firmwareStatus;
  const reconciliation = row?.reconciliation;
  const hasDiff = Boolean(reconciliation?.mismatches?.length);
  // Синхронизировать можно не всё: серийник и имя устройство отдаёт, а,
  // например, расположение — нет.
  const syncable = (reconciliation?.mismatches || [])
    .filter((mismatch) => mismatch.syncable)
    .map((mismatch) => mismatch.field);

  const applySync = async () => {
    setSyncing(true);
    setSyncError("");
    try {
      const response = await syncInventory(recordId, syncable);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSyncError(data.message || "Не удалось обновить карточку");
        return;
      }
      // Карточку перечитывает страница, запись — этот блок.
      onSynced?.();
      setRow((previous) => ({ ...previous, reconciliation: null }));
    } catch {
      setSyncError("Ошибка сети. Попробуйте ещё раз.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <Stat label="Связь">
          {monitoringOff ? (
            <DeviceStatusText tone="off" className="text-sm">
              Мониторинг выключен
            </DeviceStatusText>
          ) : (
            <DeviceStatusText tone={online ? "ok" : "bad"} className="text-sm">
              {online ? "В сети" : "Не в сети"}
            </DeviceStatusText>
          )}
        </Stat>
        <Stat label="Доступность за 30 дней">
          {row?.uptime30d != null ? (
            `${row.uptime30d.toFixed(1).replace(".", ",")} %`
          ) : (
            <span className="text-faint">—</span>
          )}
        </Stat>
        <Stat label="Прошивка">
          <span className="font-mono text-sm">
            {firmware?.installedVersion || row?.currentFirmware || "—"}
          </span>
          {firmware?.updateAvailable && !firmware?.vulnerable && (
            <span className="ms-1.5 text-xs font-normal text-faint">
              → {firmware.latestVersion}
            </span>
          )}
        </Stat>
        {firmware?.vulnerable && (
          <Stat label="Уязвимости">
            <span className="inline-flex items-center gap-1.5 text-sm text-warning">
              <RiShieldFlashLine size={14} aria-hidden />
              {firmware.cves?.length
                ? `${firmware.cves.length} CVE`
                : "есть уязвимости"}
            </span>
          </Stat>
        )}
        <Stat label="Последняя связь">
          <span className="text-sm font-medium">
            {row?.lastSuccessfulConnectionAt ? (
              formatDate(row.lastSuccessfulConnectionAt)
            ) : (
              <span className="text-faint">—</span>
            )}
          </span>
        </Stat>
      </div>

      {hasDiff && (
        // Расхождение карточки с самим устройством: показываем ЧТО именно
        // разошлось — иначе предупреждение не подсказывает, что чинить. Значения
        // подставляет сервер (клиент шлёт только имена полей).
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm">
          <div className="flex items-start gap-2.5">
            <RiAlertLine
              size={16}
              aria-hidden
              className="mt-0.5 flex-none text-warning"
            />
            <div className="min-w-0">
              <div className="font-medium">
                Данные карточки расходятся с устройством
              </div>
              <ul className="my-1.5 list-none space-y-0.5 p-0">
                {reconciliation.mismatches.map((mismatch) => (
                  <li key={mismatch.field} className="text-muted-foreground">
                    {mismatch.label}: в карточке{" "}
                    <span className="font-mono">
                      {mismatch.cardValue || "—"}
                    </span>
                    , на устройстве{" "}
                    <span className="font-mono text-foreground">
                      {mismatch.deviceValue || "—"}
                    </span>
                  </li>
                ))}
              </ul>
              {syncError && (
                <div className="mb-1.5 text-destructive">{syncError}</div>
              )}
              {canManage && syncable.length > 0 && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={syncing}
                  onClick={applySync}
                >
                  <RiRefreshLine />
                  {syncing ? "Обновляем…" : "Обновить карточку"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <Button asChild variant="outline" size="sm">
        <Link to={`/devices/mikrotik/records/${recordId}`}>
          Открыть в мониторинге <RiArrowRightSLine />
        </Link>
      </Button>
    </div>
  );
};

export default MonitoringPanel;

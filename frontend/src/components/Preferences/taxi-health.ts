import type {
  TaxiActionResult,
  TaxiSettings,
  TaxiSyncResult,
} from "@/types/taxi";

const pendingHint =
  "Яндекс пока не передал стоимость части поездок, в том числе по отменённым заказам. HD повторит сверку автоматически. Отсутствие суммы не означает нулевой расход.";

export function taxiHealth(settings?: TaxiSettings): {
  state: "idle" | "error" | "warning" | "ok";
  title: string;
  hint?: string;
  at?: string;
} {
  if (!settings?.isActive)
    return { state: "idle", title: "Корпоративное такси выключено" };
  const health = settings.health;
  // Existing installations used the connection error for ordinary finance delay.
  const legacyPending =
    health?.lastError === "Финансовые данные ещё не получены; повторим сверку";
  if (health?.lastError && !legacyPending)
    return { state: "error", title: health.lastError, at: health.lastErrorAt };
  if (health?.financialError)
    return {
      state: "error",
      title: health.financialError,
      hint: "Поездки загружены. HD повторит финансовую сверку автоматически.",
      at: settings.lastSyncAt || undefined,
    };
  if (health?.financialPending || legacyPending)
    return {
      state: "warning",
      title: "Поездки загружены, ожидаем стоимость части поездок",
      hint: pendingHint,
      at: settings.lastSyncAt || health?.lastOkAt,
    };
  return health?.lastOkAt
    ? {
        state: "ok",
        title:
          settings.lastSyncAt && health.financialPending === false
            ? "Поездки и расходы синхронизированы"
            : "Яндекс Go доступен",
        at: settings.lastSyncAt || health.lastOkAt,
      }
    : { state: "warning", title: "Доступ ещё не проверен" };
}

export function taxiSyncFeedback(result: TaxiSyncResult): TaxiActionResult {
  if (result.skipped)
    return {
      skipped: true,
      message: result.message || "Синхронизация не запущена",
    };
  if (result.financialError)
    return { error: result.financialError, message: "Поездки загружены" };
  return {
    ok: true,
    message: result.financialPending
      ? "Поездки загружены. Стоимость части поездок пока не передана Яндексом; HD повторит сверку автоматически."
      : "Поездки и расходы синхронизированы",
  };
}

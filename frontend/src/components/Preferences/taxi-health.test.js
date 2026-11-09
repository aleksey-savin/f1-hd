import { test } from "node:test";
import assert from "node:assert/strict";
import { taxiHealth, taxiSyncFeedback } from "./taxi-health.ts";
const settings = {
  isActive: true,
  clientId: "corp",
  tokenIsSet: true,
  pollSeconds: 60,
  historyDays: 14,
  lastSyncAt: "2026-11-09T06:00:00Z",
  health: { lastOkAt: "2026-11-09T06:00:00Z" },
};

test("missing finance is a warning explaining cancelled orders, not an access error", () => {
  const result = taxiHealth({
    ...settings,
    health: { ...settings.health, financialPending: true },
  });
  assert.equal(result.state, "warning");
  assert.match(result.hint, /отменённым/);
  assert.match(result.hint, /автоматически/);
  assert.equal(result.at, settings.lastSyncAt);
  const feedback = taxiSyncFeedback({
    imported: 1,
    financialPending: true,
    financialError: "",
  });
  assert.match(feedback.message, /пока/);
  assert.equal(feedback.message.includes("Синхронизация завершена"), false);
});

test("a failed finance request remains an error and never claims full success", () => {
  const financialError = "Не удалось загрузить финансовый отчёт Яндекс Go";
  assert.equal(
    taxiHealth({
      ...settings,
      health: { ...settings.health, financialPending: true, financialError },
    }).state,
    "error",
  );
  assert.equal(
    taxiSyncFeedback({ imported: 1, financialPending: true, financialError })
      .error,
    financialError,
  );
});

test("lease contention does not claim that synchronization finished", () => {
  const result = taxiSyncFeedback({
    imported: 0,
    skipped: true,
    message: "Синхронизация уже выполняется",
  });
  assert.equal(result.skipped, true);
  assert.equal(result.message, "Синхронизация уже выполняется");
});

test("legacy pending health is a warning, and later success clears pending feedback", () => {
  assert.equal(
    taxiHealth({
      ...settings,
      health: {
        lastError: "Финансовые данные ещё не получены; повторим сверку",
      },
    }).state,
    "warning",
  );
  assert.equal(taxiHealth(settings).state, "ok");
  assert.equal(
    taxiSyncFeedback({
      imported: 1,
      financialPending: false,
      financialError: "",
    }).ok,
    true,
  );
  assert.equal(taxiHealth({ ...settings, isActive: false }).state, "idle");
});

test("access check alone cannot claim that old expenses have been reconciled", () => {
  assert.equal(taxiHealth(settings).title, "Яндекс Go доступен");
  assert.equal(
    taxiHealth({
      ...settings,
      health: { ...settings.health, financialPending: false },
    }).title,
    "Поездки и расходы синхронизированы",
  );
});

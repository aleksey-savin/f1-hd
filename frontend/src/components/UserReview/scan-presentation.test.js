import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scanPresentation as presentScan,
  scanClockActive,
  scanPercent,
  scanElapsed,
} from "./scan-presentation.ts";

const at = Date.parse("2026-11-09T01:00:30Z");
const scanPresentation = (scan, paused) => presentScan(scan, paused, at);

const scan = (patch = {}) => ({
  hasRun: true,
  phase: "waiting",
  availableTotal: 14515,
  total: 14515,
  discovered: 9000,
  notDiscovered: 5515,
  checked: 8597,
  errors: 3,
  settled: 8600,
  pending: 400,
  processing: 0,
  remaining: 5915,
  discoveryComplete: false,
  startedAt: "2026-11-09T00:00:00Z",
  updatedAt: "2026-11-09T01:00:00Z",
  discoveryLeaseUntil: "2026-11-09T01:05:00Z",
  active: null,
  cadence: { analysisSeconds: 60, discoverySeconds: 300 },
  ...patch,
});
const active = (patch = {}) => ({
  ticket: { _id: "ticket-1", num: 4182, title: "Изменить доступ сотруднику" },
  stage: "checking",
  inSnapshot: true,
  startedAt: "2026-11-09T01:00:00Z",
  updatedAt: "2026-11-09T01:00:00Z",
  leaseUntil: "2026-11-09T01:05:00Z",
  ...patch,
});

test("idle offers actual available tickets without a fabricated progress denominator", () => {
  const view = scanPresentation(scan({ hasRun: false, phase: "idle" }), false);
  assert.equal(view.title, "История ещё не проверялась");
  assert.match(view.description, /14\D515 заявок/);
  assert.equal(view.progress, null);
  assert.equal(view.busy, false);
  assert.equal(view.action.intent, "scan");
  const reset = scanPresentation(scan({ hasRun: false, phase: "idle" }), true);
  assert.equal(reset.title, "История ещё не проверялась");
  assert.equal(reset.action.intent, "scan");
});

test("waiting and paused scans retain settled progress while only actual leases animate", () => {
  const waiting = scanPresentation(scan(), false);
  assert.equal(waiting.busy, false);
  assert.equal(
    waiting.steps.some((step) => step.state === "running"),
    false,
  );
  assert.equal(waiting.progress.settled, 8600);
  assert.equal(waiting.progress.checked, 8597);
  assert.equal(waiting.progress.errors, 3);
  assert.match(waiting.description, /раз в минуту/);
  const waitingForDiscovery = scanPresentation(
    scan({ pending: 0, processing: 0 }),
    false,
  );
  assert.match(waitingForDiscovery.description, /раз в 5 минут/);
  assert.doesNotMatch(waitingForDiscovery.description, /раз в минуту/);
  const paused = scanPresentation(scan({ phase: "paused" }), true);
  assert.equal(paused.busy, false);
  assert.equal(paused.action.intent, "resume");
  assert.equal(paused.progress.settled, 8600);
  assert.match(paused.description, /того же места/);
});

test("only discovery and the actual ticket stage spin, including a pause waiting for its ticket", () => {
  const discovering = scanPresentation(scan({ phase: "discovering" }), false);
  assert.equal(discovering.busy, true);
  assert.equal(discovering.steps[0].state, "running");
  const checking = scanPresentation(
    scan({ phase: "checking", active: active() }),
    false,
  );
  assert.equal(checking.steps[1].state, "running");
  const ai = scanPresentation(
    scan({ phase: "checking", active: active({ stage: "ai" }) }),
    false,
  );
  assert.equal(ai.title, "Уточняем основание по заявке");
  const stopping = scanPresentation(
    scan({ phase: "checking", active: active() }),
    true,
  );
  assert.equal(stopping.title, "Останавливаем после текущей заявки");
  assert.equal(stopping.busy, true);
  assert.equal(stopping.action, null);
});

test("incremental ticket work never becomes fake history progress or a history processing stage", () => {
  const view = scanPresentation(
    scan({
      hasRun: false,
      phase: "checking",
      active: active({ inSnapshot: false }),
    }),
    false,
  );
  assert.equal(view.title, "Проверяем отдельную заявку");
  assert.equal(view.busy, true);
  assert.equal(view.progress, null);
  assert.equal(view.steps[1].state, "waiting");
  const resetWhileIncrementalRuns = scanPresentation(
    scan({
      hasRun: false,
      phase: "checking",
      active: active({ inSnapshot: false }),
    }),
    true,
  );
  assert.equal(resetWhileIncrementalRuns.title, "Проверяем отдельную заявку");
  assert.equal(resetWhileIncrementalRuns.action.intent, "scan");
});

test("completed errors remain separate from successfully checked tickets", () => {
  const view = scanPresentation(
    scan({
      phase: "errors",
      total: 20,
      settled: 20,
      checked: 17,
      errors: 3,
      discovered: 20,
      notDiscovered: 0,
      remaining: 0,
      discoveryComplete: true,
    }),
    false,
  );
  assert.equal(view.progress.checked, 17);
  assert.equal(view.progress.errors, 3);
  assert.equal(view.progress.percentLabel, "100 %");
  assert.equal(view.showResults, true);
  assert.equal(view.action, null);
  assert.equal(view.busy, false);
  const pausedAfterCompletion = scanPresentation(
    scan({
      phase: "done",
      total: 20,
      settled: 20,
      checked: 20,
      errors: 0,
      remaining: 0,
      discoveryComplete: true,
    }),
    true,
  );
  assert.equal(pausedAfterCompletion.title, "История проверена");
  assert.equal(pausedAfterCompletion.action, null);
});

test("no eligible tickets and disabled configuration offer neither a start nor zero-over-zero progress", () => {
  const empty = scanPresentation(
    scan({ phase: "idle", hasRun: false, availableTotal: 0, total: 0 }),
    false,
  );
  assert.equal(empty.action, null);
  assert.equal(empty.progress, null);
  const disabled = scanPresentation(scan({ phase: "disabled" }), false);
  assert.equal(disabled.action, null);
  assert.equal(disabled.busy, false);
});

test("small percentages stay visible and an unfinished scan never rounds up to complete", () => {
  assert.equal(scanPercent(1, 14515).label, "< 0,1 %");
  assert.equal(scanPercent(1, 14515).value, (1 / 14515) * 100);
  assert.equal(scanPercent(1, 1000).label, "0,1 %");
  assert.equal(scanPercent(9999, 10000).label, "99,9 %");
  assert.equal(scanPercent(10000, 10000).label, "100 %");
});

test("the active ticket clock uses its real start and never invents negative elapsed time", () => {
  const now = Date.parse("2026-11-09T01:02:03Z");
  assert.equal(scanElapsed("2026-11-09T01:00:00Z", now), "2:03");
  assert.equal(scanElapsed("2026-11-09T02:00:00Z", now), "0:00");
  assert.equal(scanElapsed(null, now), null);
});

test("local time stops expired ticket and discovery stages without changing saved progress", () => {
  const later = Date.parse("2026-11-09T01:05:00Z");
  const checking = scan({ phase: "checking", active: active() });
  assert.equal(scanClockActive(checking, at), true);
  assert.equal(scanClockActive(checking, later), false);
  const expiredTicket = presentScan(checking, false, later);
  assert.equal(expiredTicket.busy, false);
  assert.equal(expiredTicket.active, null);
  assert.equal(
    expiredTicket.steps.some((step) => step.state === "running"),
    false,
  );
  assert.equal(expiredTicket.title, "Ожидаем следующую порцию");
  assert.equal(expiredTicket.progress.settled, 8600);
  const paused = presentScan(checking, true, later);
  assert.equal(paused.title, "Проверка истории на паузе");
  assert.equal(paused.action.intent, "resume");

  const discovering = scan({ phase: "discovering" });
  assert.equal(scanClockActive(discovering, at), true);
  assert.equal(scanClockActive(discovering, later), false);
  const expiredDiscovery = presentScan(discovering, false, later);
  assert.equal(expiredDiscovery.busy, false);
  assert.equal(expiredDiscovery.steps[0].state, "waiting");
  assert.equal(expiredDiscovery.title, "Ожидаем следующую порцию");
});

test("a legacy scan without lease deadlines cannot claim live processing", () => {
  const legacy = scan({
    phase: "discovering",
    discoveryLeaseUntil: undefined,
    active: active({ leaseUntil: undefined }),
  });
  assert.equal(scanClockActive(legacy, at), false);
  const view = scanPresentation(legacy, false);
  assert.equal(view.busy, false);
  assert.equal(view.active, null);
  assert.equal(
    view.steps.some((step) => step.state === "running"),
    false,
  );
});

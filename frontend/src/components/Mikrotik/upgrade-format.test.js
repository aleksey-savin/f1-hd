// node --test src/components/Mikrotik/upgrade-format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VISIBLE_STEPS,
  bannerTitle,
  branchTargets,
  compareVersions,
  currentItem,
  formatClock,
  rowUpgradeView,
  stepIndex,
  stepPhrase,
  versionLine,
} from "./upgrade-format.js";

test("backend steps map onto the seven visible steps", () => {
  assert.equal(VISIBLE_STEPS.length, 7);
  assert.equal(stepIndex("export"), 0);
  assert.equal(stepIndex("check"), 1);
  assert.equal(stepIndex("wait"), 4);
  assert.equal(stepIndex("routerbootWait"), 5);
  assert.equal(stepIndex("verify"), 6);
});

test("the wait phrase carries a clock from the reboot", () => {
  const now = Date.parse("2026-09-29T05:01:24Z");
  const item = { step: "wait", rebootRequestedAt: "2026-09-29T05:00:00Z" };
  assert.equal(stepPhrase(item, now), "ждём ответа после перезагрузки, 1:24");
  assert.equal(formatClock(600000), "10:00");
});

test("banner title counts processed of total", () => {
  assert.equal(
    bannerTitle({ counts: { processed: 3, total: 8 } }),
    "Обновление прошивки · 3 из 8",
  );
});

test("current item is the running one", () => {
  assert.equal(
    currentItem({ items: [{ state: "done" }, { state: "running", name: "B" }] })
      .name,
    "B",
  );
  assert.equal(currentItem(null), null);
});

test("row view per state", () => {
  const now = Date.parse("2026-09-29T05:01:24Z");
  assert.deepEqual(
    rowUpgradeView(
      {
        state: "running",
        step: "wait",
        rebootRequestedAt: "2026-09-29T05:00:00Z",
      },
      now,
    ),
    { kind: "running", sub: "перезагрузка · 1:24" },
  );
  assert.deepEqual(rowUpgradeView({ state: "queued" }, now), {
    kind: "queued",
    sub: "в очереди",
  });
  assert.equal(
    rowUpgradeView({ state: "done", finishedAt: "x" }, now).kind,
    "done",
  );
  assert.equal(rowUpgradeView({ state: "failed" }, now).kind, "failed");
  assert.equal(rowUpgradeView({ state: null }, now), null);
});

test("version line names RouterBOOT only when it changed", () => {
  assert.equal(
    versionLine({
      from: { os: "7.21.5", boot: "7.21.5" },
      to: { os: "7.23.7", boot: "7.23.7" },
    }),
    "RouterOS 7.21.5 → 7.23.7 · RouterBOOT 7.21.5 → 7.23.7",
  );
  assert.equal(
    versionLine({ from: { os: "7.23.5" }, to: { os: "7.23.7" } }),
    "RouterOS 7.23.5 → 7.23.7",
  );
});

test("versions compare numerically", () => {
  assert.equal(compareVersions("7.24.4", "7.23.7"), 1);
  assert.equal(compareVersions("7.9", "7.10"), -1);
  assert.equal(compareVersions("7.23.7", "7.23.7"), 0);
});

test("branch targets mark the current branch and refuse downgrades", () => {
  const releases = {
    channels: [
      { key: "7.long-term", version: "7.23.7" },
      { key: "7.stable", version: "7.24.4" },
    ],
  };
  const onLt = branchTargets({
    firmwareStatus: {
      branchKey: "7.long-term",
      channel: "long-term",
      installedVersion: "7.23.5",
    },
    releases,
  });
  assert.deepEqual(
    onLt.map((t) => [t.channel, t.version, t.current, t.downgrade]),
    [
      ["long-term", "7.23.7", true, false],
      ["stable", "7.24.4", false, false],
    ],
  );
  const onStable = branchTargets({
    firmwareStatus: {
      branchKey: "7.stable",
      channel: "stable",
      installedVersion: "7.24.4",
    },
    releases,
  });
  assert.equal(onStable[0].downgrade, true);
});

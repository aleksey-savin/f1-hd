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
  installsLabel,
  legLabel,
  pathView,
  rowUpgradeView,
  stepIndex,
  stepPhrase,
  v7Option,
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

// --- RouterOS 6 → 7 ---------------------------------------------------------

test("leg label counts legs; a single leg has none", () => {
  assert.equal(
    legLabel({ legs: ["long-term", "upgrade", "long-term"], leg: 1 }),
    "переход 2 из 3",
  );
  assert.equal(legLabel({ legs: ["upgrade", "stable"] }), "переход 1 из 2");
  assert.equal(legLabel({ legs: ["long-term"], leg: 0 }), null);
  assert.equal(legLabel({}), null);
});

test("path view marks done, the current hop with hopTo, and the rest", () => {
  const running = {
    state: "running",
    legs: ["long-term", "upgrade", "long-term"],
    leg: 1,
    hopTo: "7.12.1",
    path: ["6.45.9", "6.49.22", "7.x", "7.23.7"],
  };
  assert.deepEqual(pathView(running), [
    { version: "6.45.9", state: "done" },
    { version: "6.49.22", state: "done" },
    { version: "7.12.1", state: "now" },
    { version: "7.23.7", state: "todo" },
  ]);
  // Without hopTo (the check has not run yet) the planned placeholder stays.
  assert.equal(pathView({ ...running, hopTo: null })[2].version, "7.x");
  // A queued item: the start is done, the first hop is next.
  assert.deepEqual(
    pathView({ state: "queued", legs: ["upgrade", "stable"], path: ["6.49.22", "7.x", "7.24.4"] }).map((e) => e.state),
    ["done", "now", "todo"],
  );
  assert.deepEqual(
    pathView({ ...running, state: "done", leg: 2, hopTo: null, path: ["6.45.9", "6.49.22", "7.12.1", "7.23.7"] }).map((e) => e.state),
    ["done", "done", "done", "done"],
  );
  assert.deepEqual(pathView({ state: "queued" }), []);
});

test("installs label", () => {
  assert.equal(installsLabel(2), "две установки");
  assert.equal(installsLabel(3), "три установки");
  assert.equal(installsLabel(5), "5 установок");
});

test("v7 option: only for RouterOS 6, with memory reasons and v7 targets", () => {
  const releases = {
    channels: [
      { key: "7.long-term", version: "7.23.7" },
      { key: "7.stable", version: "7.24.4" },
      { key: "6.long-term", version: "6.49.22" },
    ],
  };
  const MB = 1024 * 1024;
  const v6 = { branchKey: "6.long-term", channel: "long-term", installedVersion: "6.45.9", latestVersion: "6.49.22" };
  assert.equal(
    v7Option({ firmwareStatus: { branchKey: "7.long-term", channel: "long-term", installedVersion: "7.23.5" }, releases, totalMemory: 256 * MB }),
    null,
  );
  assert.equal(v7Option({ firmwareStatus: null, releases, totalMemory: 256 * MB }), null);
  const ok = v7Option({ firmwareStatus: v6, releases, totalMemory: 63 * MB });
  assert.equal(ok.available, true);
  assert.equal(ok.reason, null);
  assert.equal(ok.v6Latest, "6.49.22");
  assert.deepEqual(ok.targets, [
    { channel: "long-term", version: "7.23.7" },
    { channel: "stable", version: "7.24.4" },
  ]);
  const unknown = v7Option({ firmwareStatus: v6, releases, totalMemory: null });
  assert.equal(unknown.available, false);
  assert.equal(unknown.reason, "Объём памяти ещё не считан — повторите через 5 минут");
  const low = v7Option({ firmwareStatus: v6, releases, totalMemory: 32 * MB });
  assert.equal(low.available, false);
  assert.equal(
    low.reason,
    "Мало памяти для RouterOS 7: 32 МБ, нужно не меньше 64 МБ. Устройство остаётся на RouterOS 6.",
  );
  // No release cache yet: targets without versions, v6Latest from the status.
  const bare = v7Option({ firmwareStatus: v6, releases: null, totalMemory: 128 * MB });
  assert.equal(bare.v6Latest, "6.49.22");
  assert.deepEqual(bare.targets.map((t) => t.version), [null, null]);
});

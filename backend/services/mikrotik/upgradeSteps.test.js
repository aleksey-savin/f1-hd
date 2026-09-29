// node --test services/mikrotik/upgradeSteps.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { runStep } = require("./upgradeSteps");
const { RIGHTS_FIX } = require("./upgradeErrors");

const T0 = new Date("2026-09-29T05:00:00Z");
const at = (ms) => new Date(T0.getTime() + ms);
const MIN = 60 * 1000;

const record = { _id: "r1", name: "DEV", currentFirmware: "7.23.5 (long-term)" };
const job = { _id: "j1", createdBy: "u1" };

const makeDeps = (over = {}) => {
  const calls = [];
  const deps = {
    calls,
    now: () => T0,
    save: async (set) => calls.push(["save", set]),
    exportConfig: async () => (calls.push(["export"]), { artifactId: "a1" }),
    setChannel: async (_r, channel) => calls.push(["setChannel", channel]),
    checkUpdates: async () => ({ channel: "long-term", installed: "7.23.5", latest: "7.23.7", status: "New version is available" }),
    download: async () => "status: Downloaded, please reboot router to upgrade it",
    reboot: async () => calls.push(["reboot"]),
    readRouterboard: async () => ({ routerboard: true, current: "7.23.5", upgrade: "7.23.7" }),
    upgradeRouterboard: async () => calls.push(["upgradeRouterboard"]),
    probe: async () => ({ online: true, version: "7.23.7", bootCurrent: "7.23.7", poll: { p: 1 } }),
    recover: async () => calls.push(["recover"]),
    ...over,
  };
  return deps;
};

const item = (over = {}) => ({ _id: "i1", name: "DEV", channel: "long-term", state: "running", step: "export", from: {}, to: {}, ...over });

test("export stores the artifact and moves to channel", async () => {
  const patch = await runStep(item(), { record, job }, makeDeps());
  assert.equal(patch.set.step, "channel");
  assert.equal(patch.set.artifactId, "a1");
});

test("a failed export fails the item without stopping the batch", async () => {
  const patch = await runStep(item(), { record, job }, makeDeps({ exportConfig: async () => { throw new Error("Socket timeout"); } }));
  assert.equal(patch.set.state, "failed");
  assert.equal(patch.stopBatch, undefined);
});

test("channel is always set: the build's branch is not the device's update channel", async () => {
  // record.currentFirmware says long-term, but the configured channel may differ.
  const same = makeDeps();
  assert.equal((await runStep(item({ step: "channel" }), { record, job }, same)).set.step, "check");
  assert.deepEqual(same.calls, [["setChannel", "long-term"]]);
  const other = makeDeps();
  assert.equal((await runStep(item({ step: "channel", channel: "stable" }), { record, job }, other)).set.step, "check");
  assert.deepEqual(other.calls, [["setChannel", "stable"]]);
});

test("check with a newer version goes to download", async () => {
  const patch = await runStep(item({ step: "check" }), { record, job }, makeDeps());
  assert.equal(patch.set.step, "download");
  assert.deepEqual(patch.set.to, { os: "7.23.7" });
  assert.deepEqual(patch.set.from, { os: "7.23.5" });
});

test("check when already current skips to routerboot", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ installed: "7.23.7", latest: "7.23.7", status: "System is already up to date" }) });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.step, "routerboot");
});

test("check with the device newer than the branch never downgrades", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ installed: "7.24.1", latest: "7.23.7", status: "New version is available" }) });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.step, "routerboot");
  assert.deepEqual(patch.set.to, { os: "7.24.1" });
  assert.match(patch.log, /новее последней версии ветки — понижение не выполняется/);
});

test("an ERROR status fails with the no-internet message", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ installed: "7.23.5", latest: "", status: "ERROR: could not resolve dns name" }) });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /сервером обновлений/);
});

test("check without latest-version fails, not done", async () => {
  // A fresh device (never checked) prints no latest-version at all.
  const deps = makeDeps({ checkUpdates: async () => ({ channel: "long-term", installed: "7.23.5", latest: undefined, status: "" }) });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.state, "failed");
  assert.equal(patch.set.step, undefined);
  assert.match(patch.set.error, /устройство не сообщило latest-version/);
  assert.equal(patch.stopBatch, undefined);
});

test("non-final status is not accepted", async () => {
  // check-for-updates returned early: print still shows the previous latest-version.
  const deps = makeDeps({ checkUpdates: async () => ({ channel: "long-term", installed: "7.23.5", latest: "7.23.7", status: "finding out latest version..." }) });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.state, "failed");
  assert.equal(patch.set.step, undefined);
  assert.match(patch.set.error, /finding out latest version/);
  const checking = makeDeps({ checkUpdates: async () => ({ channel: "long-term", installed: "7.23.5", latest: "7.23.7", status: "checking..." }) });
  assert.equal((await runStep(item({ step: "check" }), { record, job }, checking)).set.state, "failed");
});

test("check on a channel other than the target stops the item", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ channel: "stable", installed: "7.23.5", latest: "7.24.1", status: "New version is available" }) });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.state, "failed");
  assert.equal(patch.set.error, "Устройство сообщило ветку stable вместо long-term — обновление остановлено");
  assert.equal(patch.set.fix, undefined);
  assert.equal(patch.stopBatch, undefined);
});

test("missing rights fail with the fix command", async () => {
  const deps = makeDeps({ checkUpdates: async () => { throw new Error("not enough permissions (9)"); } });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.fix, RIGHTS_FIX);
});

test("a completed download moves to reboot", async () => {
  const patch = await runStep(item({ step: "download" }), { record, job }, makeDeps());
  assert.equal(patch.set.step, "reboot");
  assert.equal(patch.set.state, undefined);
});

test("a download past its time bound fails with the incomplete-download message", async () => {
  const timeout = Object.assign(new Error("превышено 10 минут"), { code: "MIKROTIK_DOWNLOAD_INCOMPLETE" });
  const patch = await runStep(item({ step: "download" }), { record, job }, makeDeps({ download: async () => { throw timeout; } }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /Загрузка пакета не завершилась: превышено 10 минут/);
  assert.equal(patch.stopBatch, undefined);
});

test("an incomplete download fails", async () => {
  const patch = await runStep(item({ step: "download" }), { record, job }, makeDeps({ download: async () => "status: connecting" }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /Загрузка пакета не завершилась/);
});

test("reboot stamps rebootRequestedAt BEFORE sending the command", async () => {
  const deps = makeDeps();
  const patch = await runStep(item({ step: "reboot" }), { record, job }, deps);
  assert.deepEqual(deps.calls.map((c) => c[0]), ["save", "reboot"]);
  assert.equal(patch.set.step, "wait");
});

test("reboot step with rebootRequestedAt set goes straight to wait (restart)", async () => {
  const deps = makeDeps();
  const patch = await runStep(item({ step: "reboot", rebootRequestedAt: T0 }), { record, job }, deps);
  assert.equal(patch.set.step, "wait");
  assert.deepEqual(deps.calls, []);
});

test("routerbootReboot stamps rebootRequestedAt, reboots and waits", async () => {
  const deps = makeDeps();
  const patch = await runStep(item({ step: "routerbootReboot", rebootRequestedAt: null }), { record, job }, deps);
  assert.deepEqual(deps.calls.map((c) => c[0]), ["save", "reboot"]);
  assert.equal(patch.set.step, "routerbootWait");
  assert.equal(patch.set.rebootRequestedAt, T0);
});

test("wait does not poll during the first 45 seconds", async () => {
  let probed = false;
  const deps = makeDeps({ now: () => at(30 * 1000), probe: async () => { probed = true; return { online: true }; } });
  assert.equal(await runStep(item({ step: "wait", rebootRequestedAt: T0, to: { os: "7.23.7" } }), { record, job }, deps), null);
  assert.equal(probed, false);
});

test("wait: offline under the limit waits, over it fails and stops the batch", async () => {
  const offline = async () => ({ online: false });
  const w = item({ step: "wait", rebootRequestedAt: T0, to: { os: "7.23.7" } });
  assert.equal(await runStep(w, { record, job }, makeDeps({ now: () => at(5 * MIN), probe: offline })), null);
  const patch = await runStep(w, { record, job }, makeDeps({ now: () => at(10 * MIN), probe: offline }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.stopBatch, /не вернулся/);
});

test("wait: the new version moves to routerboot", async () => {
  const patch = await runStep(item({ step: "wait", rebootRequestedAt: T0, to: { os: "7.23.7" } }), { record, job }, makeDeps({ now: () => at(2 * MIN) }));
  assert.equal(patch.set.step, "routerboot");
});

test("old version within grace waits", async () => {
  const old = async () => ({ online: true, version: "7.23.5" });
  const w = item({ step: "wait", rebootRequestedAt: T0, to: { os: "7.23.7" } });
  assert.equal(await runStep(w, { record, job }, makeDeps({ now: () => at(1 * MIN), probe: old })), null);
  const patch = await runStep(w, { record, job }, makeDeps({ now: () => at(3 * MIN), probe: old }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /установка не произошла/);
  assert.equal(patch.stopBatch, undefined);
});

test("routerboot: CHR and current boot skip to verify, outdated boot upgrades", async () => {
  const chr = makeDeps({ readRouterboard: async () => ({ routerboard: false }) });
  assert.equal((await runStep(item({ step: "routerboot" }), { record, job }, chr)).set.step, "verify");
  const same = makeDeps({ readRouterboard: async () => ({ routerboard: true, current: "7.23.7", upgrade: "7.23.7" }) });
  assert.equal((await runStep(item({ step: "routerboot" }), { record, job }, same)).set.step, "verify");
  const old = makeDeps();
  const patch = await runStep(item({ step: "routerboot", to: { os: "7.23.7" } }), { record, job }, old);
  assert.equal(patch.set.step, "routerbootReboot");
  assert.equal(patch.set.rebootRequestedAt, null);
  assert.deepEqual(patch.set.to, { os: "7.23.7", boot: "7.23.7" });
  assert.deepEqual(old.calls, [["upgradeRouterboard"]]);
});

test("routerboot: no upgrade-firmware reported skips to verify", async () => {
  const deps = makeDeps({ readRouterboard: async () => ({ routerboard: true, current: "7.23.5", upgrade: undefined }) });
  const patch = await runStep(item({ step: "routerboot" }), { record, job }, deps);
  assert.equal(patch.set.step, "verify");
  assert.deepEqual(deps.calls, []);
});

test("routerbootWait: reached boot version moves to verify", async () => {
  const patch = await runStep(item({ step: "routerbootWait", rebootRequestedAt: T0, to: { os: "7.23.7", boot: "7.23.7" } }), { record, job }, makeDeps({ now: () => at(2 * MIN) }));
  assert.equal(patch.set.step, "verify");
});

test("routerbootWait: unreadable RouterBOOT waits, then fails without stopping the batch", async () => {
  // The probe's routerboard read is best-effort: online with bootCurrent null
  // means "not readable yet", never "came back with the old RouterBOOT".
  const unreadable = async () => ({ online: true, version: "7.23.7", bootCurrent: null });
  const w = item({ step: "routerbootWait", rebootRequestedAt: T0, to: { os: "7.23.7", boot: "7.23.7" } });
  assert.equal(await runStep(w, { record, job }, makeDeps({ now: () => at(5 * MIN), probe: unreadable })), null);
  const patch = await runStep(w, { record, job }, makeDeps({ now: () => at(10 * MIN), probe: unreadable }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /Не удалось прочитать версию RouterBOOT после перезагрузки/);
  assert.equal(patch.stopBatch, undefined);
});

test("routerbootWait: the old RouterBOOT after the grace period fails", async () => {
  const old = async () => ({ online: true, version: "7.23.7", bootCurrent: "7.23.5" });
  const w = item({ step: "routerbootWait", rebootRequestedAt: T0, to: { os: "7.23.7", boot: "7.23.7" } });
  assert.equal(await runStep(w, { record, job }, makeDeps({ now: () => at(1 * MIN), probe: old })), null);
  const patch = await runStep(w, { record, job }, makeDeps({ now: () => at(3 * MIN), probe: old }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /прежним RouterBOOT 7\.23\.5/);
});

test("verify records the poll and finishes the item", async () => {
  const deps = makeDeps();
  const patch = await runStep(item({ step: "verify", stepStartedAt: T0 }), { record, job }, deps);
  assert.equal(patch.set.state, "done");
  assert.deepEqual(deps.calls, [["recover"]]);
});

test("verify: offline under the limit waits, over it fails without stopping the batch", async () => {
  const offline = async () => ({ online: false });
  const v = item({ step: "verify", stepStartedAt: T0 });
  assert.equal(await runStep(v, { record, job }, makeDeps({ now: () => at(2 * MIN), probe: offline })), null);
  const patch = await runStep(v, { record, job }, makeDeps({ now: () => at(5 * MIN), probe: offline }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /перестало отвечать после обновления/);
  assert.equal(patch.stopBatch, undefined);
});

test("a device deleted mid-batch fails its item and does not stop the batch", async () => {
  const patch = await runStep(item({ step: "download" }), { record: null, job }, makeDeps());
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /удалено/);
  assert.equal(patch.stopBatch, undefined);
});

// --- RouterOS 6 → 7: legs ---------------------------------------------------

const LEGS = ["long-term", "upgrade", "long-term"];
const legItem = (over = {}) =>
  item({ legs: LEGS, leg: 1, from: { os: "6.45.9" }, to: { os: "7.23.7" }, path: ["6.45.9", "6.49.22", "7.x", "7.23.7"], ...over });

test("channel step sets the current leg's channel and names the leg", async () => {
  const deps = makeDeps();
  const patch = await runStep(legItem({ step: "channel" }), { record, job }, deps);
  assert.equal(patch.set.step, "check");
  assert.deepEqual(deps.calls, [["setChannel", "upgrade"]]);
  assert.match(patch.log, /Переход 2 из 3: ветка upgrade/);
  const first = makeDeps();
  await runStep(legItem({ step: "channel", leg: 0 }), { record, job }, first);
  assert.deepEqual(first.calls, [["setChannel", "long-term"]]);
});

test("check on a non-final leg: up to date moves to the next leg's channel", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ channel: "long-term", installed: "6.49.22", latest: "6.49.22", status: "System is already up to date" }) });
  const patch = await runStep(legItem({ step: "check", leg: 0 }), { record, job }, deps);
  assert.equal(patch.set.step, "channel");
  assert.equal(patch.set.leg, 1);
  assert.equal(patch.set.to, undefined);
});

test("check on a non-final leg: a newer version sets hopTo and keeps the planned target", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ channel: "upgrade", installed: "6.49.22", latest: "7.12.1", status: "New version is available" }) });
  const patch = await runStep(legItem({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.step, "download");
  assert.equal(patch.set.hopTo, "7.12.1");
  assert.equal(patch.set.to, undefined);
  assert.deepEqual(patch.set.from, { os: "6.45.9" });
});

test("check on the last leg sets to.os and hopTo alike", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ channel: "long-term", installed: "7.12.1", latest: "7.23.7", status: "New version is available" }) });
  const patch = await runStep(legItem({ step: "check", leg: 2 }), { record, job }, deps);
  assert.equal(patch.set.step, "download");
  assert.deepEqual(patch.set.to, { os: "7.23.7" });
  assert.equal(patch.set.hopTo, "7.23.7");
});

test("wait compares with hopTo; a reached non-final leg moves to the next leg", async () => {
  const deps = makeDeps({ now: () => at(2 * MIN), probe: async () => ({ online: true, version: "7.12.1" }) });
  const patch = await runStep(legItem({ step: "wait", rebootRequestedAt: T0, hopTo: "7.12.1" }), { record, job }, deps);
  assert.equal(patch.set.step, "channel");
  assert.equal(patch.set.leg, 2);
  assert.equal(patch.set.rebootRequestedAt, null);
  assert.equal(patch.set.hopTo, null);
  // The real hop version replaces the planned «7.x» in the path for the UI.
  assert.equal(patch.set["path.2"], "7.12.1");
  assert.match(patch.log, /RouterOS 7\.12\.1 — переход 2 из 3 готов/);
});

test("a reached leg records its version only when hopTo and the path slot exist", async () => {
  const deps = () => makeDeps({ now: () => at(2 * MIN), probe: async () => ({ online: true, version: "6.49.22" }) });
  // Written before legs existed: no hopTo, target from to.os — no path write.
  const legacy = await runStep(item({ step: "wait", rebootRequestedAt: T0, to: { os: "6.49.22" }, legs: ["long-term", "upgrade"], leg: 0 }), { record, job }, deps());
  assert.equal(legacy.set.step, "channel");
  assert.equal(Object.keys(legacy.set).some((key) => key.startsWith("path")), false);
  const short = await runStep(legItem({ step: "wait", leg: 0, rebootRequestedAt: T0, hopTo: "6.49.22", path: ["6.45.9"] }), { record, job }, deps());
  assert.equal(short.set.step, "channel");
  assert.equal(Object.keys(short.set).some((key) => key.startsWith("path")), false);
});

test("check on the upgrade leg with nothing offered fails the item, not the batch", async () => {
  // A board MikroTik has no v7 build for answers «up to date» on channel=upgrade:
  // advancing would flash RouterBOOT and mark 6.49.22 as done.
  const deps = makeDeps({ checkUpdates: async () => ({ channel: "upgrade", installed: "6.49.22", latest: "6.49.22", status: "System is already up to date" }) });
  const patch = await runStep(legItem({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.state, "failed");
  assert.equal(patch.set.step, undefined);
  assert.equal(patch.set.error, "Ветка upgrade не предлагает RouterOS 7 для этого устройства — переход невозможен, устройство остаётся на RouterOS 6");
  assert.equal(patch.stopBatch, undefined);
  // A v6 leg that is already current still moves on.
  const v6 = makeDeps({ checkUpdates: async () => ({ channel: "long-term", installed: "6.49.22", latest: "6.49.22", status: "System is already up to date" }) });
  assert.equal((await runStep(legItem({ step: "check", leg: 0 }), { record, job }, v6)).set.step, "channel");
});

test("wait on the last leg moves to routerboot as always", async () => {
  const deps = makeDeps({ now: () => at(2 * MIN), probe: async () => ({ online: true, version: "7.23.7" }) });
  const patch = await runStep(legItem({ step: "wait", leg: 2, rebootRequestedAt: T0, hopTo: "7.23.7" }), { record, job }, deps);
  assert.equal(patch.set.step, "routerboot");
});

test("the upgrade leg waits 20 minutes for the first v7 boot", async () => {
  const offline = async () => ({ online: false });
  const w = legItem({ step: "wait", rebootRequestedAt: T0, hopTo: "7.12.1" });
  assert.equal(await runStep(w, { record, job }, makeDeps({ now: () => at(15 * MIN), probe: offline })), null);
  const patch = await runStep(w, { record, job }, makeDeps({ now: () => at(20 * MIN), probe: offline }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /за 20 минут/);
  assert.match(patch.stopBatch, /не вернулся/);
  // The other legs keep the 10-minute limit.
  const v6leg = legItem({ step: "wait", leg: 0, rebootRequestedAt: T0, hopTo: "6.49.22" });
  assert.equal((await runStep(v6leg, { record, job }, makeDeps({ now: () => at(10 * MIN), probe: offline }))).set.state, "failed");
});

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

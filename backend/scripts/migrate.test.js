const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PREVIOUS_MIGRATIONS = [
  "2026-09-25-grantConversations", "2026-09-25-initMessaging",
  "2026-09-30-normalizePhones", "2026-10-01-grantUpgradeFirmware",
  "2026-10-10-grantApproveChanges", "2026-09-30-recomputePluginRoles",
  "2026-10-01-snapshotReports", "2026-10-11-backfillMikrotikEvents",
  "2026-10-11-seedBrand", "2026-10-16-dropUniqueSerialIndex",
  "2026-10-27-singleModelConfigurations", "2026-10-29-moveDeviceTechToAttributes",
  "2026-11-07-cutoverStaffSessions", "2026-11-09-grantTaxiPermissions",
];

const migrationFixture = (t, users, applied) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-migrate-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, "state.json");
  const preloadPath = path.join(dir, "preload.cjs");
  fs.writeFileSync(statePath, JSON.stringify({ users, applied, calls: [] }));
  // Replace only external boundaries. The real CLI decides which scripts to
  // invoke, records their ledger entries and skips them on the next deploy.
  fs.writeFileSync(preloadPath, `
    const fs = require("node:fs");
    const statePath = ${JSON.stringify(statePath)};
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
    const mongoose = require(${JSON.stringify(require.resolve("mongoose"))});
    mongoose.connect = async () => {};
    mongoose.disconnect = async () => {};
    mongoose.connection.db = { collection(name) {
      if (name === "users") return { countDocuments: async () => state.users };
      if (name === "migrations") return {
        find: () => ({ toArray: async () => state.applied.map(_id => ({ _id })) }),
        updateOne: async (filter) => {
          if (!state.applied.includes(filter._id)) state.applied.push(filter._id);
          save();
        },
      };
      throw new Error("Unexpected collection: " + name);
    } };
    require("node:child_process").spawnSync = (_node, args) => {
      state.calls.push(args);
      save();
      return { status: 0 };
    };
  `);
  return {
    run: (command) => {
      const result = spawnSync(process.execPath, ["--require", preloadPath, path.join(__dirname, "migrate.js"), command], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return JSON.parse(fs.readFileSync(statePath, "utf8"));
    },
  };
};

test("an already recorded taxi grant still receives the administrator repair exactly once", (t) => {
  const fixture = migrationFixture(t, 3, PREVIOUS_MIGRATIONS);
  const first = fixture.run("up");
  assert.deepEqual(first.calls, [["scripts/grantTaxiPermissions.js", "--apply"], ["scripts/upgradeUserReviewRoles.js", "--apply"], ["scripts/backfillUserActivity.js", "--apply"], ["scripts/removeTaxiBooking.js", "--apply"], ["scripts/ensureProxmoxExposureIndexes.js", "--apply"], ["scripts/grantProxmoxPermissions.js", "--apply"], ["scripts/grantTicketMessaging.js", "--apply"], ["scripts/upgradeConversationAccess.js", "--apply"]]);
  assert.ok(first.applied.includes("2026-11-09-repairTaxiAdminPermissions"));
  const nextDeploy = fixture.run("up");
  assert.deepEqual(nextDeploy.calls, first.calls);
});

test("a fresh installation baselines the taxi repair without granting permissions before bootstrap", (t) => {
  const fixture = migrationFixture(t, 0, []);
  const baseline = fixture.run("pending");
  assert.deepEqual(baseline.calls, []);
  assert.ok(baseline.applied.includes("2026-11-09-repairTaxiAdminPermissions"));
});

test('user review role upgrade and applicant cache repair are ledgered once', (t)=>{
 const applied=[...PREVIOUS_MIGRATIONS,'2026-11-09-repairTaxiAdminPermissions'];
 const fixture=migrationFixture(t,3,applied);
 const first=fixture.run('up');
 assert.deepEqual(first.calls,[['scripts/upgradeUserReviewRoles.js','--apply'],['scripts/backfillUserActivity.js','--apply'],['scripts/removeTaxiBooking.js','--apply'],['scripts/ensureProxmoxExposureIndexes.js','--apply'],['scripts/grantProxmoxPermissions.js','--apply'],['scripts/grantTicketMessaging.js','--apply'],['scripts/upgradeConversationAccess.js','--apply']]);
 assert.deepEqual(fixture.run('up').calls,first.calls);
});

test('an existing deployment applies taxi booking cleanup after all prior ledger entries exactly once', (t) => {
  const applied = [...PREVIOUS_MIGRATIONS, '2026-11-09-repairTaxiAdminPermissions', '2026-11-09-upgradeUserReviewRoles', '2026-11-09-backfillUserActivity'];
  const fixture = migrationFixture(t, 3, applied);
  const first = fixture.run('up');
  assert.deepEqual(first.calls, [['scripts/removeTaxiBooking.js', '--apply'], ['scripts/ensureProxmoxExposureIndexes.js', '--apply'], ['scripts/grantProxmoxPermissions.js', '--apply'], ['scripts/grantTicketMessaging.js', '--apply'], ['scripts/upgradeConversationAccess.js', '--apply']]);
  assert.ok(first.applied.includes('2026-11-09-removeTaxiBooking'));
  assert.deepEqual(fixture.run('up').calls, first.calls);
});

test('an up-to-date deployment grants Proxmox administrator permissions exactly once', (t) => {
  const applied = [...PREVIOUS_MIGRATIONS, '2026-11-09-repairTaxiAdminPermissions', '2026-11-09-upgradeUserReviewRoles', '2026-11-09-backfillUserActivity', '2026-11-09-removeTaxiBooking', '2026-11-10-proxmoxExposureIndexes'];
  const fixture = migrationFixture(t, 3, applied);
  const first = fixture.run('up');
  assert.deepEqual(first.calls, [['scripts/grantProxmoxPermissions.js', '--apply'], ['scripts/grantTicketMessaging.js', '--apply'], ['scripts/upgradeConversationAccess.js', '--apply']]);
  assert.ok(first.applied.includes('2026-11-11-grantProxmoxPermissions'));
  assert.deepEqual(fixture.run('up').calls, first.calls);
});

test('a fresh installation baselines the Proxmox grant without running it before bootstrap', (t) => {
  const fixture = migrationFixture(t, 0, []);
  const baseline = fixture.run('pending');
  assert.deepEqual(baseline.calls, []);
  assert.ok(baseline.applied.includes('2026-11-11-grantProxmoxPermissions'));
});

test('ticket messenger permission is granted exactly once on an otherwise current deployment', t => {
  const applied = [...PREVIOUS_MIGRATIONS, '2026-11-09-repairTaxiAdminPermissions', '2026-11-09-upgradeUserReviewRoles', '2026-11-09-backfillUserActivity', '2026-11-09-removeTaxiBooking', '2026-11-10-proxmoxExposureIndexes', '2026-11-11-grantProxmoxPermissions'];
  const fixture = migrationFixture(t, 3, applied);
  const first = fixture.run('up');
  assert.deepEqual(first.calls, [['scripts/grantTicketMessaging.js', '--apply'], ['scripts/upgradeConversationAccess.js', '--apply']]);
  assert.ok(first.applied.includes('2026-11-11-grantTicketMessaging'));
  assert.deepEqual(fixture.run('up').calls, first.calls);
});

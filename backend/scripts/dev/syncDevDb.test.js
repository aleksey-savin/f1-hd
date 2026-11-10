const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const syncScript = path.resolve(__dirname, "../../../ops/sync-dev-db.sh");

// Run the real shell script; only external processes are substituted. A restore
// refuses a target with running writers, reproducing the calendar/index race.
const fixture = (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hd-sync-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "state.json");
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(statePath, JSON.stringify({ running: true, events: [] }));
  const driver = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const file = process.env.SYNC_TEST_STATE;
const state = JSON.parse(fs.readFileSync(file));
const record = (event) => { state.events.push(event); fs.writeFileSync(file, JSON.stringify(state)); };
const fail = (message) => { console.error(message); process.exit(1); };
if (command === 'timeout' || command === 'ssh') process.exit(0);
if (command === 'mongorestore') {
  if (process.env.CHECK_WAZZUP_EXCLUSIONS) {
    for (const collection of ['wazzupsettings', 'wazzupevents']) {
      if (!args.some((arg, index) => arg === '--nsExclude' && args[index + 1] === 'hd-source.' + collection)) fail('restoring live Wazzup collection ' + collection);
    }
  }
  if (args.includes('--dryRun')) { record('dry-run'); if (process.env.FAIL_DRY_RUN) fail('bad archive'); process.exit(0); }
  record('restore');
  if (state.running) fail('DuplicateKey: country ru year 2026: backend wrote during restore');
  if (process.env.FAIL_RESTORE) fail('restore interrupted');
  process.exit(0);
}
if (command === 'mongosh') {
  const js = args.at(-1);
  if (js.includes('dropped.forEach')) {
    if (process.env.CHECK_WAZZUP_EXCLUSIONS) {
      for (const collection of ['wazzupsettings', 'wazzupevents']) {
        if (!js.includes("'" + collection + "'")) fail('dropping local Wazzup collection ' + collection);
      }
    }
    record('drop'); if (state.running) fail('drop while writers running'); }
  if (js.includes('migrations')) console.log('39');
  else if (js.includes('email:')) console.log('0');
  else if (js.includes("map(c => c + '='")) console.log('preferences=1,channels=0,channeljobs=0,taxisettings=0');
  process.exit(0);
}
if (command === 'docker') {
  if (args[0] === 'inspect') { console.log('/hd-mongodb-1'); process.exit(0); }
  if (args[0] !== 'compose') fail('unexpected docker command');
  const action = args[1];
  if (action === 'port') { console.log('0.0.0.0:27017'); process.exit(0); }
  if (action === 'config') { console.log('mongodb\\nbackend\\ntg-service'); process.exit(0); }
  if (action === 'ps') { console.log(args.includes('--services') ? 'mongodb\\nbackend\\ntg-service' : 'mongo-id'); process.exit(0); }
  if (action === 'stop') { record('stop'); if (process.env.FAIL_STOP) fail('cannot stop backend'); state.running = false; fs.writeFileSync(file, JSON.stringify(state)); process.exit(0); }
  if (action === 'start' || action === 'restart') { record('start'); state.running = true; fs.writeFileSync(file, JSON.stringify(state)); process.exit(0); }
  if (action === 'run') {
    if (args.includes('--preflight')) { record('mask-preflight'); process.exit(0); }
    if (args.includes('--target')) { console.log('База: hd-sync-test'); process.exit(0); }
    record('mask');
    if (state.running) fail('mask while writers running');
    if (process.env.FAIL_MASK) fail('mask interrupted');
    process.exit(0);
  }
  fail('unexpected compose action ' + action);
}
fail('unexpected command');
`;
  for (const command of ["docker", "mongosh", "mongorestore", "ssh", "timeout"]) {
    fs.writeFileSync(path.join(bin, command), driver, { mode: 0o755 });
  }
  const archive = path.join(directory, "fixture.archive.gz");
  fs.writeFileSync(archive, "fake archive consumed only by test driver");
  const run = (args = [], overrides = {}) => spawnSync("bash", [syncScript, "--from-archive", archive, "--yes", ...args], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SYNC_ENV: path.join(directory, "no-config"),
      DEV_MONGO_HOST: "127.0.0.1", DEV_MONGO_PORT: "27017", DEV_MONGO_USER: "test", DEV_MONGO_PASS: "test",
      DEV_DB: "hd-sync-test", PROD_DB: "hd-source", DEV_PASSWORD: "local-test-password",
      SYNC_TEST_STATE: statePath, ...overrides },
  });
  return { run, state: () => JSON.parse(fs.readFileSync(statePath)) };
};

test("sync quiesces writers before dropping/restoring and starts them after masking", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.state().events, ["mask-preflight", "dry-run", "stop", "drop", "restore", "mask", "start"]);
  assert.equal(f.state().running, true);
});

test("failed restore stays stopped and a retry from the archive succeeds", (t) => {
  const f = fixture(t);
  const failed = f.run(["--raw"], { FAIL_RESTORE: "1" });
  assert.notEqual(failed.status, 0);
  assert.equal(f.state().running, false);
  assert.equal(f.state().events.includes("start"), false);
  const retry = f.run(["--raw"]);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.equal(f.state().running, true);
});

test("failed masking never starts the application over an unmasked copy", (t) => {
  const f = fixture(t);
  const result = f.run([], { FAIL_MASK: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(f.state().running, false);
  assert.equal(f.state().events.includes("start"), false);
  assert.match(result.stdout + result.stderr, /NOT masked|still holds real data/);
});

test("no-restart still stops writers during restore and leaves them stopped", (t) => {
  const f = fixture(t);
  const result = f.run(["--raw", "--no-restart"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.state().running, false);
  assert.deepEqual(f.state().events, ["dry-run", "stop", "drop", "restore"]);
});

test("a rejected archive leaves the running application and database alone", (t) => {
  const f = fixture(t);
  assert.notEqual(f.run(["--raw"], { FAIL_DRY_RUN: "1" }).status, 0);
  assert.equal(f.state().running, true);
  assert.deepEqual(f.state().events, ["dry-run"]);
});

test("failure to stop writers aborts before dropping any collections", (t) => {
  const f = fixture(t);
  assert.notEqual(f.run(["--raw"], { FAIL_STOP: "1" }).status, 0);
  assert.deepEqual(f.state().events, ["dry-run", "stop"]);
});

test("sync never imports production Wazzup secrets or webhook queue and preserves local ones", (t) => {
  const f = fixture(t);
  const result = f.run(["--raw"], { CHECK_WAZZUP_EXCLUSIONS: "1" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

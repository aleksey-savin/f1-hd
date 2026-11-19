const test = require("node:test");
const assert = require("node:assert/strict");
const { collectorFor, parseInventory } = require("./guest-inventory");

const ubuntu = {
  id: "ubuntu",
  "version-id": "22.04",
  "pretty-name": "Ubuntu 22.04.5 LTS",
  "kernel-release": "5.15.0-191-generic",
};
test("collectors are fixed read-only commands; guest values never enter executable arguments", () => {
  const command = collectorFor({ ...ubuntu, "pretty-name": "$(reboot)" });
  assert.equal(command[0], "/bin/sh");
  assert.ok(command[2].includes("dpkg-query"));
  assert.ok(!command.join(" ").includes("reboot"));
  const windows = collectorFor({ id: "mswindows" });
  const script = Buffer.from(windows.at(-1), "base64").toString("utf16le");
  assert.match(script, /Microsoft.Update.Session/);
  assert.match(script, /CveIDs/);
  assert.doesNotMatch(
    script,
    /CreateUpdateDownloader|CreateUpdateInstaller|\.Install\(|\.Download\(/,
  );
  assert.equal(collectorFor({ id: "centos" }), null);
});
test("dpkg inventory keeps source versions, epochs and only installed packages", () => {
  const inventory = parseInventory(
    ubuntu,
    "HD_GUEST_INVENTORY_V1\ninstalled\tlibssl3:amd64\t3.0.2-0ubuntu1.15\topenssl\t3.0.2-0ubuntu1.15\nconfig-files\told\t1\told\t1\ninstalled\tqemu-guest-agent\t1:6.2+dfsg-2ubuntu6.26\tqemu\t1:6.2+dfsg-2ubuntu6.26\n",
  );
  assert.equal(inventory.packages.length, 2);
  assert.equal(inventory.packages[0].name, "libssl3");
  assert.equal(inventory.packages[0].source, "openssl");
  assert.equal(inventory.packages[1].sourceVersion, "1:6.2+dfsg-2ubuntu6.26");
  assert.equal(inventory.os.kernel, ubuntu["kernel-release"]);
});
test("malformed, empty and truncated inventories cannot produce a clean CVE check", () => {
  for (const output of [
    "",
    "permission denied",
    "HD_GUEST_INVENTORY_V1\n",
    "HD_GUEST_INVENTORY_V1\ninstalled\tssl\tbroken",
  ])
    assert.throws(() => parseInventory(ubuntu, output));
  assert.throws(() => parseInventory(ubuntu, "x".repeat(2 * 1024 * 1024 + 1)));
});
test("Windows inventory rejects incomplete WUA searches and retains missing KB and CVEs", () => {
  const windows = { id: "mswindows", "pretty-name": "Windows Server 2022" };
  const value = {
    schema: 1,
    build: "20348.4294",
    resultCode: 2,
    updates: [
      {
        id: "u",
        title: "Security update",
        kb: ["5063880"],
        cves: ["CVE-2025-12345"],
        severity: "Critical",
        security: true,
      },
    ],
  };
  const inventory = parseInventory(windows, JSON.stringify(value));
  assert.equal(inventory.os.build, "20348.4294");
  assert.equal(inventory.updates[0].kb[0], "5063880");
  assert.throws(() =>
    parseInventory(windows, JSON.stringify({ ...value, resultCode: 3 })),
  );
});

test("Windows WUA failures preserve independently collected servicing metadata", () => {
  for (const status of ["error", "timeout"]) {
    const inventory = parseInventory({ id: "mswindows" }, JSON.stringify({
      schema: 1, build: "17763.8027", installationType: "Server",
      rebootRequired: null, windowsUpdate: { status, errorCode: status === "error" ? "8024402C" : null }, updates: [],
    }));
    assert.equal(inventory.os.build, "17763.8027");
    assert.equal(inventory.os.installationType, "Server");
    assert.equal(inventory.rebootRequired, null);
    assert.equal(inventory.windowsUpdate.status, status);
    assert.deepEqual(inventory.updates, []);
  }
});
test("partial Windows inventory rejects fabricated failures and unvalidated updates", () => {
  const value = { schema: 1, build: "17763.1", rebootRequired: false, updates: [], windowsUpdate: { status: "error", errorCode: "8024402C" } };
  for (const patch of [{ build: "" }, { windowsUpdate: { status: "error", errorCode: "secret" } }, { updates: [{}] }, { rebootRequired: "false" }])
    assert.throws(() => parseInventory({ id: "mswindows" }, JSON.stringify({ ...value, ...patch })));
});
test("Windows collector owns a killable child and never waits indefinitely for COM cleanup", () => {
  const script = Buffer.from(collectorFor({ id: "mswindows" }).at(-1), "base64").toString("utf16le");
  assert.doesNotMatch(script, /Start-Job|Stop-Job|Remove-Job|WaitForExit\(\)|Get-Process|taskkill/i);
  assert.match(script, /WaitForExit\(180000\)/);
  assert.match(script, /\.Kill\(\)/);
  assert.match(script, /ReadToEndAsync/);
  assert.match(script, /InnerException/);
  assert.ok(script.indexOf("CurrentVersion") < script.indexOf("$process.Start()"));
});
test("Windows component update payloads are validated and bounded", () => {
  const child = { id: "child", title: "component", kb: ["1234567"], cves: [], severity: "", security: true };
  const value = { schema: 1, build: "17763.1", resultCode: 2, updates: [{ ...child, id: "parent", componentUpdates: [child] }] };
  assert.deepEqual(parseInventory({ id: "mswindows" }, JSON.stringify(value)).updates[0].componentUpdates, [child]);
  for (const componentUpdates of [[{ ...child, kb: ["bad"] }], Array(2000).fill(child), [{ ...child, componentUpdates: [child] }]])
    assert.throws(() => parseInventory({ id: "mswindows" }, JSON.stringify({ ...value, updates: [{ ...child, componentUpdates }] })));
});

test("Windows failure metadata returns only allowlisted public fields", () => {
  const inventory = parseInventory({ id: "mswindows" }, JSON.stringify({ schema: 1, build: "17763.1", updates: [], windowsUpdate: { status: "error", errorCode: "8024402c", raw: "private upstream" } }));
  assert.deepEqual(inventory.windowsUpdate, { status: "error", errorCode: "8024402C" });
});

test("Windows component uncertainty is explicit and must be a boolean", () => {
  const update = { id: "parent", title: "Rollup", kb: ["1234567"], cves: ["CVE-2026-12345"], severity: "", security: true, componentCoverageIncomplete: true };
  const value = { schema: 1, build: "17763.1", resultCode: 2, updates: [update] };
  assert.equal(parseInventory({ id: "mswindows" }, JSON.stringify(value)).updates[0].componentCoverageIncomplete, true);
  assert.throws(() => parseInventory({ id: "mswindows" }, JSON.stringify({ ...value, updates: [{ ...update, componentCoverageIncomplete: "false" }] })));
  const script = Buffer.from(collectorFor({ id: "mswindows" }).at(-1), "base64").toString("utf16le");
  assert.match(script, /\$entry\.componentCoverageIncomplete = \$script:componentCoverageIncomplete/);
  assert.match(script, /\$depth -ge 2[\s\S]*?BundledUpdates\.Count -gt 0[\s\S]*?componentCoverageIncomplete = \$true/);
});

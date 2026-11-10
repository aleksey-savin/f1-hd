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

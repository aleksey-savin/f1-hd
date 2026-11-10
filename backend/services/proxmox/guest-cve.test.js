const test = require("node:test");
const assert = require("node:assert/strict");
const { queryLinux, evaluateWindows, ecosystemsFor } = require("./guest-cve");
const inventory = (version = "3.0.2-0ubuntu1.15") => ({
  os: { id: "ubuntu", version: "22.04", name: "Ubuntu 22.04 LTS" },
  packages: [
    { name: "libssl3", version, source: "openssl", sourceVersion: version },
    { name: "openssl", version, source: "openssl", sourceVersion: version },
  ],
});
const bulletin = {
  id: "CVE-2024-12345",
  source: "openssl",
  ranges: [
    {
      type: "ECOSYSTEM",
      events: [{ introduced: "0" }, { fixed: "3.0.2-0ubuntu1.20" }],
    },
  ],
  severity: "high",
};
test("kernel CVEs do not match userspace headers from the same source package", async () => {
  const input = inventory();
  input.packages = [
    {
      name: "linux-libc-dev",
      source: "linux",
      version: "6.12.1-1",
      sourceVersion: "6.12.1-1",
    },
  ];
  const result = await queryLinux(input, {
    load: async () => ({
      rows: [
        {
          ...bulletin,
          source: "linux",
          ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }] }],
        },
      ],
      source: "Debian",
      fetchedAt: new Date(),
    }),
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.reviewFindings.length, 0);
  assert.equal(result.status, "partial");
  assert.equal(result.kernelCovered, false);
});
test("local matching deduplicates binaries and respects backported fixes without sending inventory", async () => {
  const load = async (os) => {
    assert.deepEqual(Object.keys(os).sort(), ["id", "version"]);
    return {
      rows: [bulletin],
      source: "Ubuntu Security Team",
      fetchedAt: new Date(),
    };
  };
  const result = await queryLinux(inventory(), { load });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].packages.length, 2);
  assert.equal(result.findings[0].fixedVersion, "3.0.2-0ubuntu1.20");
  assert.equal(
    (await queryLinux(inventory("3.0.2-0ubuntu1.20"), { load })).findings
      .length,
    0,
  );
});
test("unconfirmed Ubuntu entries are separate; missing feeds fail instead of claiming clean", async () => {
  const result = await queryLinux(inventory(), {
    load: async () => ({
      rows: [
        {
          ...bulletin,
          review: true,
          ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }] }],
        },
      ],
      source: "Ubuntu",
      fetchedAt: new Date(),
    }),
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.reviewFindings.length, 1);
  await assert.rejects(
    queryLinux(inventory(), {
      load: async () => {
        throw new Error("feed unavailable");
      },
    }),
    /feed unavailable/,
  );
});
test("release ecosystems keep standard and Pro data separate", () => {
  assert.deepEqual(ecosystemsFor({ id: "ubuntu", version: "20.04" }), [
    "Ubuntu:20.04:LTS",
    "Ubuntu:Pro:20.04:LTS",
  ]);
  assert.deepEqual(ecosystemsFor({ id: "debian", version: "13" }), [
    "Debian:13",
  ]);
  assert.deepEqual(ecosystemsFor({ id: "linuxmint", version: "22" }), []);
});
test("host QEMU advisories require review when only Guest Agent is installed", async () => {
  const input = inventory();
  input.packages = [
    {
      name: "qemu-guest-agent",
      source: "qemu",
      sourceVersion: "1:10.0.1-1",
      version: "1:10.0.1-1",
    },
  ];
  const result = await queryLinux(input, {
    load: async () => ({
      rows: [
        {
          ...bulletin,
          source: "qemu",
          ranges: [
            {
              type: "ECOSYSTEM",
              events: [{ introduced: "0" }, { fixed: "1:10.0.9-1" }],
            },
          ],
        },
      ],
      source: "Debian",
      fetchedAt: new Date(),
    }),
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.reviewFindings.length, 1);
});
test("Windows CVEs are deduplicated; missing CVE metadata is partial", () => {
  const data = {
    baselineCovered: true,
    os: { id: "mswindows", name: "Windows Server 2022", build: "20348.4294" },
    updates: [
      {
        title: "Update",
        id: "u1",
        kb: ["5000001"],
        cves: ["CVE-2025-12345"],
        security: true,
        severity: "Critical",
      },
      {
        title: "Update2",
        id: "u2",
        kb: ["5000002"],
        cves: ["CVE-2025-12345"],
        security: true,
        severity: "Important",
      },
    ],
  };
  const result = evaluateWindows(data);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].updates.length, 2);
  assert.equal(result.status, "completed");
  assert.equal(
    evaluateWindows({ ...data, updates: [{ ...data.updates[0], cves: [] }] })
      .status,
    "partial",
  );
});

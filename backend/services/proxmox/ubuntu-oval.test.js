const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUbuntuOval, evaluateUbuntuOval } = require("./ubuntu-oval");
const fixture = (
  criteria = '<criterion test_ref="pkg"/>',
  state = '<evr datatype="debian_evr_string" operation="less than">2.0-1</evr>',
) =>
  `<oval_definitions xmlns="http://oval.mitre.org/XMLSchema/oval-definitions-5"><definitions><definition id="patch" class="patch"><metadata><reference source="CVE" ref_id="CVE-2026-12345"/><advisory><cve priority="high">CVE-2026-12345</cve></advisory></metadata><criteria>${criteria}</criteria></definition></definitions><tests><dpkginfo_test id="pkg" check="at least one" check_existence="at_least_one_exists"><object object_ref="obj"/><state state_ref="state"/></dpkginfo_test></tests><objects><dpkginfo_object id="obj"><name>libexample1</name></dpkginfo_object></objects><states><dpkginfo_state id="state">${state}</dpkginfo_state></states></oval_definitions>`;
const inventory = (version) => ({
  os: { id: "ubuntu", version: "26.04" },
  packages: [
    { name: "libexample1", version, source: "example", sourceVersion: version },
  ],
});
const run = async (xml, version = "1.0-1") =>
  evaluateUbuntuOval(inventory(version), {
    kind: "ubuntu-oval",
    oval: await parseUbuntuOval(Buffer.from(xml)),
    version: "26.04",
    source: "Canonical",
    fetchedAt: "2026-11-18",
  });
test("official binary version criterion identifies vulnerable packages and excludes fixed versions", async () => {
  assert.equal((await run(fixture())).findings.length, 1);
  assert.equal((await run(fixture(), "2.0-1")).findings.length, 0);
  assert.equal((await run(fixture(), "3.0-1")).findings.length, 0);
});
test("unknown AND criterion cannot confirm a CVE; false AND excludes it", async () => {
  const unknown = await run(
    fixture('<criterion test_ref="pkg"/><criterion test_ref="unknown"/>'),
  );
  assert.equal(unknown.findings.length, 0);
  assert.equal(unknown.reviewFindings.length, 1);
  assert.equal(unknown.status, "partial");
  assert.equal(
    (
      await run(
        fixture('<criterion test_ref="pkg"/><criterion test_ref="unknown"/>'),
        "2.0-1",
      )
    ).reviewFindings.length,
    0,
  );
});
test("architecture restrictions cannot be discarded and OR retains a proven branch", async () => {
  assert.equal(
    (
      await run(
        fixture(
          undefined,
          '<arch>arm64</arch><evr datatype="debian_evr_string" operation="less than">2.0-1</evr>',
        ),
      )
    ).findings.length,
    0,
  );
  assert.equal(
    (
      await run(
        fixture(
          '<criteria operator="OR"><criterion test_ref="unknown"/><criterion test_ref="pkg"/></criteria>',
        ),
      )
    ).findings.length,
    1,
  );
});
test("invalid, empty, entity XML and wrong release never produce a clean result", async () => {
  assert.throws(() => parseUbuntuOval(Buffer.from("<broken>")));
  assert.throws(() => parseUbuntuOval(Buffer.from("<oval_definitions/>")));
  assert.throws(() =>
    parseUbuntuOval(
      Buffer.from('<!DOCTYPE foo [<!ENTITY x "x">]><oval_definitions/>'),
    ),
  );
  const feed = {
    oval: await parseUbuntuOval(Buffer.from(fixture())),
    version: "24.04",
  };
  assert.throws(() => evaluateUbuntuOval(inventory("1.0-1"), feed));
});
test("a proven OR branch does not attach packages from unknown branches", async () => {
  const xml = fixture(
    '<criteria operator="OR"><criterion test_ref="pkg"/><criterion test_ref="other"/></criteria>',
  )
    .replace(
      "</tests>",
      '<dpkginfo_test id="other" check="at least one"><object object_ref="otherObj"/><state state_ref="otherState"/></dpkginfo_test></tests>',
    )
    .replace(
      "</objects>",
      '<dpkginfo_object id="otherObj"><name>other</name></dpkginfo_object></objects>',
    )
    .replace(
      "</states>",
      '<dpkginfo_state id="otherState"><arch>arm64</arch><evr datatype="debian_evr_string" operation="less than">2.0-1</evr></dpkginfo_state></states>',
    );
  const inv = inventory("1.0-1");
  inv.packages.push({ name: "other", version: "1.0-1" });
  const report = evaluateUbuntuOval(inv, {
    oval: parseUbuntuOval(Buffer.from(xml)),
    version: "26.04",
  });
  assert.deepEqual(
    report.findings[0].packages.map((p) => p.name),
    ["libexample1"],
  );
  assert.deepEqual(
    report.reviewFindings[0].packages.map((p) => p.name),
    ["other"],
  );
});
test("Canonical constant binary lists use installed binary versions, not source versions", () => {
  const xml = fixture()
    .replace(
      "<name>libexample1</name>",
      '<name var_ref="binaries" var_check="at least one"/>',
    )
    .replace(
      "</oval_definitions>",
      '<variables><constant_variable id="binaries" datatype="string"><value>libexample1</value><value>libexample-dev</value></constant_variable></variables></oval_definitions>',
    );
  const inv = inventory("2.0-1");
  inv.packages[0].sourceVersion = "1.0-1";
  const feed = { oval: parseUbuntuOval(Buffer.from(xml)), version: "26.04" };
  assert.equal(evaluateUbuntuOval(inv, feed).findings.length, 0);
  inv.packages[0].version = "1.0-1";
  inv.packages[0].sourceVersion = "9.0-1";
  assert.equal(
    evaluateUbuntuOval(inv, feed).findings[0].packages[0].fixedVersion,
    "2.0-1",
  );
});

test("confirmed CVE preserves uncertain package evidence from another definition", () => {
  const xml = fixture()
    .replace(
      "</definitions>",
      '<definition id="uncertain" class="patch"><metadata><reference source="CVE" ref_id="CVE-2026-12345"/></metadata><criteria><criterion test_ref="second"/><criterion test_ref="unsupported"/></criteria></definition></definitions>',
    )
    .replace(
      "</tests>",
      '<dpkginfo_test id="second" check="at least one"><object object_ref="secondObj"/><state state_ref="state"/></dpkginfo_test></tests>',
    )
    .replace(
      "</objects>",
      '<dpkginfo_object id="secondObj"><name>second</name></dpkginfo_object></objects>',
    );
  const inv = inventory("1.0-1");
  inv.packages.push({ name: "second", version: "1.0-1" });
  const report = evaluateUbuntuOval(inv, {
    oval: parseUbuntuOval(Buffer.from(xml)),
    version: "26.04",
  });
  assert.deepEqual(
    report.findings[0].packages.map((p) => p.name),
    ["libexample1"],
  );
  assert.deepEqual(
    report.reviewFindings[0].packages.map((p) => p.name),
    ["second"],
  );
});
test("confirmed package only removes the identical name and version from review", () => {
  const xml = fixture().replace(
    "</definitions>",
    '<definition id="uncertain" class="patch"><metadata><reference source="CVE" ref_id="CVE-2026-12345"/></metadata><criteria><criterion test_ref="pkg"/><criterion test_ref="unsupported"/></criteria></definition></definitions>',
  );
  const inv = inventory("1.0-1");
  inv.packages.push({ ...inv.packages[0], version: "1.0-1+pve1" });
  const report = evaluateUbuntuOval(inv, {
    oval: parseUbuntuOval(Buffer.from(xml)),
    version: "26.04",
  });
  assert.deepEqual(
    report.findings[0].packages.map((p) => p.version),
    ["1.0-1"],
  );
  assert.deepEqual(
    report.reviewFindings[0].packages.map((p) => p.version),
    ["1.0-1+pve1"],
  );
});

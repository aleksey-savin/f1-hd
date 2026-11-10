const test = require("node:test");
const assert = require("node:assert/strict");
const { compareDebianVersions, affectedByRanges } = require("./deb-version");
test("Debian version ordering respects epochs, tilde, revisions and numeric runs", () => {
  for (const [a, b] of [
    ["1.0~rc1", "1.0"],
    ["1.0", "1.0-1"],
    ["1.0-1ubuntu2", "1.0-1ubuntu10"],
    ["1.0+deb12u1", "1.0+deb12u2"],
    ["9.9", "1:1.0"],
    ["1.0a", "1.0+"],
    ["1.0~~", "1.0~"],
  ]) {
    assert.ok(compareDebianVersions(a, b) < 0, `${a} < ${b}`);
    assert.ok(compareDebianVersions(b, a) > 0);
  }
  assert.equal(compareDebianVersions("1.01-0", "0:1.1"), 0);
});
test("backported fixed version closes its interval; later reintroductions are separate", () => {
  const ranges = [
    {
      type: "ECOSYSTEM",
      events: [
        { introduced: "0" },
        { fixed: "3.0.2-0ubuntu1.20" },
        { introduced: "3.0.2-0ubuntu1.22" },
        { fixed: "3.0.2-0ubuntu1.25" },
      ],
    },
  ];
  assert.equal(affectedByRanges("3.0.2-0ubuntu1.15", ranges), true);
  assert.equal(affectedByRanges("3.0.2-0ubuntu1.20", ranges), false);
  assert.equal(affectedByRanges("3.0.2-0ubuntu1.23", ranges), true);
  assert.equal(affectedByRanges("3.0.2-0ubuntu1.25", ranges), false);
});

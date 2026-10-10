// node --test services/mikrotik/configDiff.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { diffConfigs, summarizeDiff, MAX_SECTIONS } = require("./configDiff");

const config = (sections) => ({ sections: Object.entries(sections).map(([path, lines]) => ({ path, lines })) });

test("summarizeDiff counts lines, names menus and lists the lines by menu", () => {
  const older = config({ "/ip firewall filter": ["add chain=input a", "add chain=input b"], "/ip dns": ["set servers=1.1.1.1"] });
  const newer = config({ "/ip firewall filter": ["add chain=input a", "add chain=input c"], "/ip dns": ["set servers=1.1.1.1"], "/ip pool": ["add name=p1"] });
  assert.deepEqual(summarizeDiff(diffConfigs(older, newer)), {
    added: 2,
    removed: 1,
    sections: ["/ip firewall filter", "/ip pool"],
    moreSections: 0,
    lines: ["/ip firewall filter", "- add chain=input b", "+ add chain=input c", "/ip pool", "+ add name=p1"],
  });
});

test("summarizeDiff caps the menu list and says how many are left", () => {
  const sections = Object.fromEntries(Array.from({ length: MAX_SECTIONS + 3 }, (_, i) => [`/menu ${i}`, [`add n=${i}`]]));
  const summary = summarizeDiff(diffConfigs(config({}), config(sections)));
  assert.equal(summary.sections.length, MAX_SECTIONS);
  assert.equal(summary.moreSections, 3);
  assert.equal(summary.added, MAX_SECTIONS + 3);
});

test("summarizeDiff of nothing is empty", () => {
  assert.deepEqual(summarizeDiff([]), { added: 0, removed: 0, sections: [], moreSections: 0, lines: [] });
});

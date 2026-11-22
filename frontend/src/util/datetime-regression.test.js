import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
let settings = { timezone: "Asia/Vladivostok", personalTimezone: "Europe/Moscow" };
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const compiled = ts.transpile(source("./format-date.js"), { module: ts.ModuleKind.CommonJS });
const dates = {};
new Function("require", "exports", compiled)((id) => id === "./auth"
  ? { getLocalStorageData: () => settings } : require(id), dates);

// Run actual declarations from UI modules without mounting unrelated UI or network hooks.
function declarations(path, names, dependencies) {
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const nodes = file.statements.filter((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some((d) => names.includes(d.name.getText(file))));
  return new Function(...Object.keys(dependencies),
    ts.transpile(nodes.map((n) => n.getText(file)).join("\n") + `\nreturn {${names.join(",")}};`,
      { target: ts.ScriptTarget.ES2022 }))(...Object.values(dependencies));
}

function inBrowser(zone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { fn(); } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("datetime load and save ignore a browser DST gap in a different display zone", () => {
  for (const browser of ["UTC", "America/New_York", "Pacific/Honolulu"]) inBrowser(browser, () => {
    assert.equal(dates.utcToLocalForm("2026-03-07T23:30:00Z"), "2026-03-08T02:30");
    assert.equal(dates.localToUtc("2026-03-08T02:30"), "2026-03-07T23:30:00.000Z");
    assert.equal(dates.shiftLocalForm("2026-03-08T01:30", 60), "2026-03-08T02:30");
  });
});

test("schedule version follows the organization day, regardless of personal zone", () => {
  const at = new Date("2026-11-21T15:00:00Z");
  const { activeVersion } = declarations("../components/User/UserForm.jsx", ["todayKey", "activeVersion"], {
    businessDayKey: () => dates.businessDayKey(at),
    organizationDayKey: () => dates.organizationDayKey(at),
  });
  assert.equal(activeVersion({ workSchedules: [
    { effectiveFrom: "2026-11-01", schedule: "old" },
    { effectiveFrom: "2026-11-22", schedule: "new" },
  ] }).schedule, "new");
});

test("open-ticket date filter includes the entire organization day with exclusive next midnight", () => {
  const { matchesFacets } = declarations("../store/lists/tickets.js", ["matchesFacets"], {
    matchesComments: () => true, matchesSearch: () => true,
    organizationDayKey: dates.organizationDayKey,
  });
  const filter = { responsibles: [], applicants: [], categories: [], states: [], companies: [],
    createdFrom: "2026-11-22", createdTo: "2026-11-22" };
  for (const browser of ["UTC", "Asia/Vladivostok", "America/New_York"]) inBrowser(browser, () => {
    for (const [createdAt, expected] of [
      ["2026-11-21T13:59:59.999Z", false], ["2026-11-21T14:00:00Z", true],
      ["2026-11-22T13:59:59.999Z", true], ["2026-11-22T14:00:00Z", false],
    ]) assert.equal(matchesFacets({ createdAt }, filter), expected, `${browser}: ${createdAt}`);
  });
});

test("work duration uses saved instants instead of the browser DST rules", () => {
  const file = ts.createSourceFile("use-work-form.js", source("../components/Work/use-work-form.js"), ts.ScriptTarget.Latest, true);
  let expression;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "durationMs") expression = node.initializer.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const duration = new Function("useMemo", "startedAt", "finishedAt", "localToUtc", `return ${expression}`);
  inBrowser("America/New_York", () => {
    assert.equal(duration((fn) => fn(), "2026-03-08T01:30", "2026-03-08T03:30", dates.localToUtc), 7200000);
    assert.equal(duration((fn) => fn(), "", "", dates.localToUtc), null);
  });
});

test("display-zone DST changes determine elapsed work time even in a UTC browser", () => {
  const previous = settings;
  settings = { timezone: "Asia/Vladivostok", personalTimezone: "America/New_York" };
  try {
    inBrowser("UTC", () => {
      assert.equal(new Date(dates.localToUtc("2026-03-08T03:30")) - new Date(dates.localToUtc("2026-03-08T01:30")), 3600000);
      assert.equal(dates.shiftLocalForm("2026-03-08T01:30", 60), "2026-03-08T03:30");
      assert.equal(dates.toDateTimeLocal("2026-11-01T04:00:00Z"), "2026-11-01T00:00");
    });
  } finally { settings = previous; }
});

test("security form loads the organization date and submits a calendar key", () => {
  const code = ts.transpile(source("../components/Preferences/Security.jsx"), {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  });
  const exports = {};
  const deps = {
    "react": { useState: (value) => [value, () => {}] },
    "@/util/format-date": dates,
    "@/store/authed-user": { useAuthedUser: () => ({ twoFactorEnabled: true }) },
  };
  new Function("require", "exports", "React", code)((id) => deps[id] || { default: id }, exports,
    { createElement: (type, props, ...children) => ({ type, props, children }) });
  inBrowser("Pacific/Honolulu", () => {
    const tree = exports.default({ prefs: { timezone: "Asia/Vladivostok", twoFactorPolicy: {
      requireForAdmins: true, graceUntil: "2026-11-22T13:59:59.999Z",
    } } });
    assert.equal(tree.props.buildPayload().twoFactorPolicy.graceUntil, "2026-11-22");
  });
});

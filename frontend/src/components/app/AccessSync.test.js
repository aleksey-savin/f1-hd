import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { accessChanged } from "../../lib/access-refresh.ts";

// Execute the component's effect with controlled IO and React scheduling.
// The real identity-change decision and effect body remain under test.
const source = ts.createSourceFile("AccessSync.tsx", readFileSync(new URL("./AccessSync.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = source.statements.filter((node) => !ts.isImportDeclaration(node) && !ts.isExportAssignment(node)).map((node) => node.getText(source)).join("\n");
const compiled = ts.transpile(`${body}\nreturn AccessSync;`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ routeError = false, load } = {}) {
  let effect;
  let refreshed;
  let revalidations = 0;
  const user = { _id: "u1", accessVersion: "before" };
  const pending = { current: false };
  const deps = {
    useEffect: (fn) => { effect = fn; }, useRef: () => pending,
    useNavigate: () => () => {}, useAuthedUser: () => user,
    usePulseStore: (select) => select({ access: { userId: "u1", version: "after" } }),
    useRouteErrorStore: (select) => select({ active: routeError }),
    useDeferredRevalidate: () => async () => { revalidations++; },
    refreshAuthData: load || (async () => ({ userData: { _id: "u1", accessVersion: "after", statements: {} } })),
    accessChanged,
  };
  const Component = new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  const run = () => {
    Component({ onRefresh: (value) => { refreshed = value; } });
    effect();
  };
  return { run, user, get refreshed() { return refreshed; }, get revalidations() { return revalidations; } };
}

test("revocation refreshes identity without reloading child data or erasing an open editor", async () => {
  const f = fixture();
  f.run();
  await flush();
  assert.equal(f.refreshed.userData.accessVersion, "after");
  assert.deepEqual(f.refreshed.userData.statements, {});
  assert.equal(f.revalidations, 0);
});

test("a previously failed loader is retried after refreshing identity", async () => {
  const f = fixture({ routeError: true });
  f.run();
  await flush();
  assert.equal(f.revalidations, 1);
});

test("failed identity refresh retries on another pulse and never applies another account", async () => {
  let calls = 0;
  const f = fixture({ load: async () => {
    if (++calls === 1) throw new Error("offline");
    return { userData: { _id: "u2", accessVersion: "after" } };
  } });
  f.run();
  await flush();
  f.run();
  await flush();
  assert.equal(calls, 2);
  assert.equal(f.refreshed, undefined);
  assert.equal(f.revalidations, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { matchRoutes } from "react-router";
import { makeCan } from "../lib/access.ts";
import { routeAccessAllowed } from "../lib/route-access.ts";
import { canManageEntity } from "../components/app/entity-permissions.ts";

const root = new URL("../", import.meta.url);
// Execute the real route registrations and component declarations, replacing
// visual imports and browser hooks only; permission checks stay in production code.
function sourceModule(path, bindings = {}) {
  const file = ts.createSourceFile(
    path,
    readFileSync(new URL(path, root), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const deps = { React };
  for (const node of file.statements.filter(ts.isImportDeclaration)) {
    if (node.importClause?.name)
      deps[node.importClause.name.text] = node.importClause.name.text;
    for (const name of node.importClause?.namedBindings?.elements ?? [])
      deps[name.name.text] = name.name.text;
  }
  Object.assign(deps, bindings);
  const body = file.statements
    .filter(
      (node) => !ts.isImportDeclaration(node) && !ts.isExportAssignment(node),
    )
    .map((node) => node.getText(file))
    .join("\n");
  return { file, deps, body };
}
function evaluate(code, deps) {
  const js = ts.transpile(
    code.replaceAll("import.meta.env.VITE_API_ADDRESS", '""'),
    { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  );
  return new Function(...Object.keys(deps), js)(...Object.values(deps));
}
function render(path, name, bindings, props) {
  const { deps, body } = sourceModule(path, bindings);
  return evaluate(`${body}\nreturn ${name};`, deps)(props);
}
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
function declaration(path, name, deps) {
  const { file } = sourceModule(path);
  let expression;
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      expression = node.initializer.getText(file);
    ts.forEachChild(node, walk);
  }
  walk(file);
  return evaluate(`return (${expression});`, deps);
}

test("template ownership recognizes the populated API author and legacy IDs", () => {
  for (const createdBy of [{ _id: "me", firstName: "Иван" }, "me"])
    assert.equal(
      canManageEntity("ticketTemplate", makeCan({}), { createdBy }, "me"),
      true,
    );
  for (const createdBy of [{ _id: "other" }, "other", null])
    assert.equal(
      canManageEntity("ticketTemplate", makeCan({}), { createdBy }, "me"),
      false,
    );
});

test("route gates permit own template creation and require knowledge management", () => {
  const { file, deps } = sourceModule("App.jsx", {
    SHEET_LG: {},
    SHEET_MD: {},
    SHEET_XL: {},
  });
  const routes = [];
  function walk(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const path = node.properties.find(
        (p) => p.name?.getText(file) === "path",
      )?.initializer;
      if (
        path &&
        [
          "ticket-templates",
          "ticket-templates/add",
          "ticket-templates/:id",
          "knowledge-base",
        ].includes(path.text)
      ) {
        routes.push(
          evaluate(`return (${node.getText(file)});`, {
            ...deps,
            ticketFormRoutes: () => [],
          }),
        );
        return;
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(file);
  const allowed = (path, statements) =>
    routeAccessAllowed(
      matchRoutes(routes, path).map((m) => m.route.handle || {}),
      makeCan(statements),
    );
  assert.equal(allowed("/ticket-templates/add", {}), true);
  assert.equal(allowed("/ticket-templates", {}), false);
  assert.equal(allowed("/knowledge-base/add", { knowledge: ["read"] }), false);
  assert.equal(
    allowed("/knowledge-base/add", { knowledge: ["read", "manage"] }),
    true,
  );
});

test("work-only roles can select tickets and see work action only with read and log", () => {
  for (const [work, enabled, expected] of [
    [["read", "log"], true, true],
    [["log"], true, false],
    [["read"], true, false],
    [["read", "log"], false, false],
  ]) {
    const can = makeCan({ work });
    const modules = { timeTracking: { isActive: enabled } };
    assert.equal(
      declaration("pages/Ticket/List.jsx", "canSelect", { can, modules }),
      expected,
    );
    const tree = render(
      "components/Ticket/BulkActionBar.jsx",
      "TicketBulkActionBar",
      {
        useCan: () => can,
        useContext: () => ({ _id: "me" }),
        useState: () => [null, () => {}],
        useInitialPrefsStore: () => ({ modules }),
        addWorksReason: () => null,
      },
      { selectedItems: [], selectionActive: true },
    );
    const bar = elements(tree).find((e) => e.type === "BulkActionBarBase");
    assert.equal(
      bar.props.actions.some((a) => a.key === "works"),
      expected,
    );
  }
});

test("template routine creation uses routine permission independently of template ownership", () => {
  for (const [statements, expected] of [
    [{ ticketTemplate: ["manage"] }, false],
    [{ routineTask: ["manage"] }, false],
    [{ routineTask: ["read", "manage"] }, true],
  ]) {
    const tree = render(
      "components/TicketTemplate/View.jsx",
      "ViewTicketTemplate",
      {
        useCan: () => makeCan(statements),
        useContext: () => ({ _id: "me" }),
        useState: () => [false, () => {}],
        useEffect: () => {},
        canManageEntity,
        formatShortDate: () => "",
        cn: () => "",
      },
      { template: { _id: "t1", createdBy: { _id: "other" } } },
    );
    assert.equal(
      elements(tree).some(
        (e) => e.props?.to === "/routine-tasks/add?fromTemplate=t1",
      ),
      expected,
    );
  }
});

test("Mikrotik inventory synchronization requires device management", () => {
  const row = {
    reconciliation: { mismatches: [{ field: "hostname", syncable: true }] },
  };
  for (const [statements, canManage, expected] of [
    [{}, true, false],
    [{ device: ["manage"] }, true, true],
    [{ device: ["manage"] }, false, false],
  ]) {
    let state = 0;
    const tree = render(
      "components/ClientDevice/MonitoringPanel.jsx",
      "MonitoringPanel",
      {
        useCan: () => makeCan(statements),
        useState: (initial) => [state++ === 0 ? row : initial, () => {}],
        useEffect: () => {},
        useLiveTopic: () => {},
        useMikrotikDeviceFilterStore: () => () => {},
      },
      { device: { mikrotik: { recordId: "r1" } }, canManage },
    );
    assert.equal(
      elements(tree).some((e) => e.props?.onClick?.name === "applySync"),
      expected,
    );
  }
});

test("new template save opens its own card instead of the gated catalogue", () => {
  const { file } = sourceModule("components/TicketTemplate/Form.jsx");
  let callback;
  function walk(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0].getText(file).includes("fetcher.state")
    )
      callback = node.arguments[0].getText(file);
    ts.forEachChild(node, walk);
  }
  walk(file);
  const destinations = [];
  evaluate(`return (${callback});`, {
    fetcher: { state: "idle", data: { _id: "new-template" } },
    isEdit: false,
    close: (...args) => destinations.push(args),
  })();
  assert.deepEqual(destinations, [
    ["/ticket-templates/new-template", { replace: true }],
  ]);
});

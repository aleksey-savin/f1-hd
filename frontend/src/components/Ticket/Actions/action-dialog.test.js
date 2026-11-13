import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

import { closeBlockers, hasOtherResponsibles } from "../ticket-actions.js";
import { toggleGreeting } from "./closing-message.ts";

// Execute the real dialog and its effects with controlled hooks, as in AccessSync.test.js.
// UI leaves are element records; assertions cover field values and submitted payloads.
const source = ts.createSourceFile(
  "ActionDialog.jsx",
  readFileSync(new URL("./ActionDialog.jsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JSX,
);
const body = source.statements
  .filter((node) => !ts.isImportDeclaration(node) && !ts.isExportAssignment(node))
  .map((node) => node.getText(source))
  .join("\n");
const compiled = ts.transpile(`${body}\nreturn ActionDialog;`, {
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.React,
});

function fixture() {
  const slots = [];
  let cursor;
  let effects;
  let tree;
  let submitted;
  let props = {
    action: "close",
    ticket: { _id: "t1", num: 51713, version: 1, responsibles: [] },
    onClose: () => {},
  };
  const fetcher = {
    state: "idle",
    data: undefined,
    submit: (payload) => { submitted = payload; },
  };
  const deps = {
    React: { createElement: (type, attrs, ...children) => ({ type, props: attrs ?? {}, children }) },
    useState: (initial) => {
      const at = cursor++;
      if (!(at in slots)) slots[at] = initial;
      return [slots[at], (value) => { slots[at] = value; }];
    },
    useRef: (initial) => {
      const at = cursor++;
      return slots[at] ??= { current: initial };
    },
    useEffect: (effect, next) => {
      const at = cursor++;
      const previous = slots[at];
      if (!previous || next.some((value, i) => !Object.is(value, previous[i]))) {
        effects.push(effect);
        slots[at] = next;
      }
    },
    useTicketAction: () => fetcher,
    useCan: () => () => true,
    useAuthedUser: () => ({ _id: "u1" }),
    closeBlockers,
    hasOtherResponsibles,
    utcToLocalForm: (value) => value,
    localToUtc: (value) => value,
    isTouchPointer: () => false,
  };
  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    const clause = statement.importClause;
    const names = [clause?.name, ...(clause?.namedBindings?.elements ?? []).map((item) => item.name)];
    for (const name of names.filter(Boolean).map((item) => item.text)) {
      if (!(name in deps)) deps[name] = name;
    }
  }
  const Component = new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  function render(update = {}) {
    props = { ...props, ...update };
    // Flush effects, then render their state changes.
    for (let pass = 0; pass < 2; pass++) {
      cursor = 0;
      effects = [];
      tree = Component(props);
      effects.forEach((effect) => effect());
    }
  }
  function find(type, node = tree) {
    if (!node || typeof node !== "object") return undefined;
    if (node.type === type) return node.props;
    return (node.children ?? []).flat(Infinity).map((child) => find(type, child)).find(Boolean);
  }
  render();
  return { render, find, get ticket() { return props.ticket; }, get submitted() { return submitted; } };
}

test("first greeting and manual edits survive ticket revalidation and are submitted with the latest version", () => {
  const f = fixture();
  const chips = f.find("ClosingChips");
  chips.onChange(toggleGreeting(chips.value, "Добрый день!"));
  f.render({ ticket: { ...f.ticket, version: 2 } });
  assert.equal(f.find("Textarea").value, "Добрый день!");

  f.find("Textarea").onChange({ target: { value: "Добрый день! Принтер работает." } });
  f.render({ ticket: { ...f.ticket, version: 3 } });
  assert.equal(f.find("Textarea").value, "Добрый день! Принтер работает.");
  f.find("form").onSubmit({ preventDefault() {} });
  assert.deepEqual(f.submitted, {
    intent: "close", _id: "t1", expectedVersion: 3,
    closingComment: "Добрый день! Принтер работает.",
  });
});

test("a new opening, action or ticket starts with an empty message", () => {
  const f = fixture();
  const type = () => {
    f.find("Textarea").onChange({ target: { value: "Прежний текст" } });
    f.render();
  };
  type();
  f.render({ action: null });
  f.render({ action: "close" });
  assert.equal(f.find("Textarea").value, "");
  type();
  f.render({ action: "reject" });
  assert.equal(f.find("Textarea").value, "");
  type();
  f.render({ ticket: { ...f.ticket, _id: "t2", num: 51714 } });
  assert.equal(f.find("Textarea").value, "");
});

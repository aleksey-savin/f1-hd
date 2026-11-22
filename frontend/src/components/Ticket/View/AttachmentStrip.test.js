import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.createSourceFile(
  "AttachmentStrip.jsx",
  readFileSync(new URL("./AttachmentStrip.jsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JSX,
);
const body = source.statements
  .filter((n) => !ts.isImportDeclaration(n) && !ts.isExportAssignment(n))
  .map((n) => n.getText(source))
  .join("\n")
  .replaceAll("export const", "const")
  .replaceAll("import.meta.env.VITE_API_ADDRESS", '""');
const code = ts.transpile(body + "\nreturn AttachmentStrip;", {
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.React,
});
function fixture(canTranscribe, status) {
  const changes = [];
  const deps = {
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: props || {},
        children,
      }),
    },
    useState: (initial) => [initial, (value) => changes.push(value)],
    useToastStore: () => ({ showToast() {} }),
    useViewTicketStore: () => ({}),
    attachmentKind: () => "audio",
    attachmentName: (a) => a?.name,
    fileUrl: (n) => n,
  };
  for (const n of [
    "Button",
    "RiAttachment2",
    "RiFileTextLine",
    "RiVoiceprintLine",
    "RiDownloadLine",
    "Dialog",
    "DialogContent",
    "DialogHeader",
    "DialogTitle",
  ])
    deps[n] = n;
  const render = new Function(...Object.keys(deps), code)(
    ...Object.values(deps),
  );
  const tree = render({
    attachments: [
      {
        name: "call.wav",
        speechToText: { status, text: "Existing transcript" },
      },
    ],
    canTranscribe,
    canDelete: false,
    ticketNum: 1,
  });
  const buttons = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === "Button") buttons.push(n);
    n.children?.forEach(walk);
  }
  walk(tree);
  return { buttons, changes };
}
for (const status of ["ready", "error", "pending"])
  test(`stored transcript remains readable without generation permission (${status})`, () => {
    const { buttons, changes } = fixture(false, status);
    const button = buttons.find((b) =>
      b.children
        .flat(Infinity)
        .some((x) => typeof x === "string" && x.trim() === "Расшифровка"),
    );
    assert.ok(button);
    button.props.onClick();
    assert.ok(changes.includes("call.wav"));
  });

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const eslint = new ESLint({
  overrideConfigFile: fileURLToPath(
    new URL("../../eslint.config.mjs", import.meta.url),
  ),
});
test("module settings cannot become separate pages or navigation entries", async () => {
  for (const code of [
    'export const route = {path:"taxi/settings",element:<TaxiSettings/>};',
    'export const Action = () => <Link to="/taxi/settings">Настройки</Link>;',
  ]) {
    const [result] = await eslint.lintText(code, {
      filePath: "src/pages/Taxi/Example.tsx",
    });
    assert.ok(
      result.messages.some(
        (message) =>
          message.ruleId === "no-restricted-syntax" &&
          /preferences/.test(message.message),
      ),
    );
  }
  const [valid] = await eslint.lintText(
    'export const route = {path:"taxi/settings",loader:()=>redirect("/preferences#taxi")};',
    { filePath: "src/pages/Taxi/Example.tsx" },
  );
  assert.equal(
    valid.messages.some((message) => message.ruleId === "no-restricted-syntax"),
    false,
  );
});
test("lint rejects the native taxi-report date fields and names the shared replacement", async () => {
  for (const type of [
    'type="date"',
    'type="datetime-local"',
    'type={"date"}',
  ]) {
    const [result] = await eslint.lintText(
      `const Example = () => <input ${type} />; export default Example;`,
      { filePath: "src/pages/Taxi/Example.tsx" },
    );
    const failures = result.messages.filter(
      (message) => message.ruleId === "no-restricted-syntax",
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /DateRangeField/);
  }
  const [valid] = await eslint.lintText(
    'const Example = () => <><DateRangeField /><input type="time" /></>; export default Example;',
    { filePath: "src/pages/Taxi/Example.tsx" },
  );
  assert.equal(
    valid.messages.some((message) => message.ruleId === "no-restricted-syntax"),
    false,
  );
});

test("ticket labels omit the numero sign in strings, JSX and templates", async () => {
  for (const code of [
    'export const label = "Заявка ' + '№51713";',
    "export const Label = () => <span>Заявка " + "№51713</span>;",
    "export const label = (num) => `Заявка " + "№${num}`;",
  ]) {
    const [result] = await eslint.lintText(code, {
      filePath: "src/pages/Ticket/Example.tsx",
    });
    assert.ok(
      result.messages.some(
        (message) =>
          message.ruleId === "no-restricted-syntax" &&
          /Номер заявки/.test(message.message),
      ),
    );
  }
  const [valid] = await eslint.lintText(
    'export const label = "Заявка 51713"; export const inventory = "Инв. №";',
    { filePath: "src/pages/Ticket/Example.tsx" },
  );
  assert.equal(
    valid.messages.some((message) => message.ruleId === "no-restricted-syntax"),
    false,
  );
});

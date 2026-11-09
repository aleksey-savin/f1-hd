import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCan } from "../lib/access.ts";
import { routeAccessAllowed } from "../lib/route-access.ts";
import {
  GLOBAL_SETTINGS_ACCESS,
  canOpenGlobalSettings,
} from "./global-settings-access.ts";

test("global settings are accessible to a taxi configurator without granting other settings", () => {
  for (const statements of [
    { settings: ["manage"] },
    { taxi: ["configure"] },
  ]) {
    const can = makeCan(statements);
    assert.equal(canOpenGlobalSettings(can), true);
    assert.equal(
      routeAccessAllowed([{ canAny: GLOBAL_SETTINGS_ACCESS }], can),
      true,
    );
  }
  for (const statements of [{}, { taxi: ["read"] }, { user: ["read"] }])
    assert.equal(canOpenGlobalSettings(makeCan(statements)), false);
});
test("an alternative leaf requirement cannot bypass a parent's mandatory permission", () => {
  const handles = [
    { can: { company: ["read"] } },
    { canAny: GLOBAL_SETTINGS_ACCESS },
  ];
  assert.equal(
    routeAccessAllowed(handles, makeCan({ taxi: ["configure"] })),
    false,
  );
  assert.equal(
    routeAccessAllowed(
      handles,
      makeCan({ company: ["read"], taxi: ["configure"] }),
    ),
    true,
  );
});

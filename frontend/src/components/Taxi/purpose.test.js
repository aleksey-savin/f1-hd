import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultTaxiPurpose,
  taxiPurposeLabel,
  taxiPurposeOptions,
} from "./purpose.ts";
test("internal company defaults to service, clients to a visit; home is displayed as personal", () => {
  assert.equal(
    defaultTaxiPurpose("own", [{ _id: "own", alias: "Own", isInternal: true }]),
    "service",
  );
  assert.equal(
    defaultTaxiPurpose("customer", [{ _id: "customer", alias: "Client" }]),
    "business",
  );
  assert.equal(defaultTaxiPurpose("", []), "unknown");
  assert.equal(taxiPurposeLabel("home"), "Личная");
  assert.deepEqual(
    taxiPurposeOptions.map((p) => p.label),
    ["Служебная", "Выезд к клиенту", "Личная", "Не указано"],
  );
});

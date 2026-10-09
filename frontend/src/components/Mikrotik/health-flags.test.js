// node --test src/components/Mikrotik/health-flags.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  backupFacetValue,
  backupFlag,
  capitalize,
  licenseFacetValue,
  licenseFlag,
} from "./health-flags.js";

const day = () => "02.09";

test("лицензия в порядке или не считана — флага нет", () => {
  assert.equal(licenseFlag(null, day), null);
  assert.equal(licenseFlag({ state: "ok", soon: false }, day), null);
  assert.equal(
    licenseFlag({ state: "ok", soon: false, until: "2026-11-14" }, day),
    null,
  );
});

test("истёкшая лицензия — с датой, когда она известна", () => {
  assert.equal(
    licenseFlag({ state: "expired", until: "2026-09-02" }, day).text,
    "лицензия истекла 02.09",
  );
  assert.equal(
    licenseFlag({ state: "expired", until: null }, day).text,
    "лицензия истекла",
  );
});

test("неактивная и близкая к сроку", () => {
  assert.equal(
    licenseFlag({ state: "inactive", kind: "chr" }, day).text,
    "лицензия не активна",
  );
  assert.equal(
    licenseFlag({ state: "ok", soon: true, until: "2026-09-02" }, day).text,
    "лицензия до 02.09",
  );
});

test("копии: флаг только у проблемы", () => {
  assert.equal(backupFlag({ state: "ok" }), null);
  assert.equal(backupFlag({ state: "pending" }), null);
  assert.equal(backupFlag(undefined), null);
  assert.equal(backupFlag({ state: "none" }).text, "нет копий");
  assert.equal(backupFlag({ state: "noSchedule" }).text, "без расписания");
  assert.equal(
    backupFlag({ state: "noSchedule" }).heroText,
    "Копии не настроены",
  );
  assert.equal(backupFlag({ state: "failed" }).heroText, "Копия не снята");
});

test("фасеты", () => {
  assert.equal(licenseFacetValue(null), null);
  assert.equal(licenseFacetValue({ state: "ok", soon: false }), "ok");
  assert.equal(licenseFacetValue({ state: "ok", soon: true }), "problem");
  assert.equal(licenseFacetValue({ state: "expired" }), "problem");
  assert.equal(licenseFacetValue({ state: "inactive" }), "problem");
  assert.equal(backupFacetValue({ state: "none" }), "missing");
  assert.equal(backupFacetValue({ state: "noSchedule" }), "missing");
  assert.equal(backupFacetValue({ state: "failed" }), "failed");
  assert.equal(backupFacetValue({ state: "pending" }), "ok");
  assert.equal(backupFacetValue(undefined), null);
});

test("capitalize", () => {
  assert.equal(capitalize("лицензия истекла"), "Лицензия истекла");
});

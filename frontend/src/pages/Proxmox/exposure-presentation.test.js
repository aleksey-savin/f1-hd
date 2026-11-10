import test from "node:test";
import assert from "node:assert/strict";
import {
  exposureLabel,
  exposureTone,
  exposureReason,
} from "./exposure-presentation.js";
test("exposure labels preserve uncertainty and do not invent a service or exploitability", () => {
  assert.equal(
    exposureLabel({ state: "public", hasPublic: true }),
    "Есть проброс из интернета",
  );
  assert.equal(
    exposureLabel({ state: "unknown", reasonCodes: ["routerSnapshotStale"] }),
    "Нет свежих данных о пробросах",
  );
  assert.equal(exposureLabel({ state: "none" }), "Прямых пробросов не найдено");
  assert.equal(
    exposureTone({ state: "public", hasPublic: true }),
    "text-destructive",
  );
  assert.match(exposureReason("unsupportedCondition"), /услов/i);
});

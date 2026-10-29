// node --test src/components/Vendor/vendor-kinds.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchKind, modelKindOptions } from "./vendor-kinds.ts";

const model = (type) => ({ deviceTypeId: type });
const laptop = model({ name: "Ноутбук" });
const monitor = model({ name: "Монитор", isPeripheral: true });
const toner = model({ name: "Картридж", isConsumable: true });

test("modelKindOptions: «Все» первым, пустые разделы не показываются", () => {
  assert.deepEqual(modelKindOptions([laptop, laptop, monitor, toner]), [
    { value: "all", label: "Все", count: 4 },
    { value: "primary", label: "Устройства", count: 2 },
    { value: "peripheral", label: "Периферия", count: 1 },
    { value: "consumable", label: "Расходники", count: 1 },
  ]);
});

test("modelKindOptions: одно назначение — сегмента нет", () => {
  assert.deepEqual(modelKindOptions([laptop, model(null)]), []);
  assert.deepEqual(modelKindOptions([]), []);
});

test("matchKind: «Все» пропускает любую, раздел — только своё назначение", () => {
  assert.equal(matchKind(monitor, "all"), true);
  assert.equal(matchKind(monitor, "peripheral"), true);
  assert.equal(matchKind(monitor, "primary"), false);
  // Модель без типа — устройство, как тип без флагов
  assert.equal(matchKind(model(null), "primary"), true);
});

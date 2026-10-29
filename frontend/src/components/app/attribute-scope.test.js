// node --test src/components/app/attribute-scope.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { SCOPE_OPTIONS, deviceLinks, modelLinks } from "./attribute-scope.ts";

const link = (id, scope) => ({ _id: id, attributeId: scope === undefined ? { _id: `a${id}` } : { _id: `a${id}`, scope } });
const links = [link(1, "model"), link(2, "device"), link(3), link(4, "device"), { _id: 5, attributeId: "raw-id" }];
const ids = (list) => list.map((l) => l._id);

test("связки раскладываются по уровню атрибута", () => {
  assert.deepEqual(ids(modelLinks(links)), [1, 3, 5]);
  assert.deepEqual(ids(deviceLinks(links)), [2, 4]);
});

test("без scope и без populated атрибута — уровень модели; пустой вход — пусто", () => {
  assert.deepEqual(ids(modelLinks([link(7)])), [7]);
  assert.deepEqual(deviceLinks(undefined), []);
  assert.deepEqual(modelLinks(null), []);
});

test("SCOPE_OPTIONS — подписи сегмента", () => {
  assert.deepEqual(SCOPE_OPTIONS, [
    { value: "model", label: "У модели" },
    { value: "device", label: "У каждого устройства" },
  ]);
});

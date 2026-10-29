// node --test src/components/ClientDevice/device-params.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { laterHint, paramsForStep } from "./device-params.ts";

const link = (id, name, required = false) => ({
  _id: `l${id}`,
  required,
  attributeId: { _id: `a${id}`, name, scope: "device" },
});
const links = [
  link(1, "Операционная система", true),
  link(2, "IP-адрес"),
  link(3, "MAC-адрес"),
  link(4, "Дата производства"),
];

test("мастер: показаны обязательные, остальные — именами «потом»", () => {
  const { shown, laterNames } = paramsForStep(links, "wizard");
  assert.deepEqual(
    shown.map((l) => l._id),
    ["l1"],
  );
  assert.deepEqual(laterNames, ["IP-адрес", "MAC-адрес", "Дата производства"]);
});

test("правка: показаны все, «потом» пусто", () => {
  const { shown, laterNames } = paramsForStep(links, "edit");
  assert.equal(shown.length, 4);
  assert.deepEqual(laterNames, []);
});

test("без связок — пусто", () => {
  assert.deepEqual(paramsForStep(undefined, "wizard"), { shown: [], laterNames: [] });
});

test("laterHint: перечисление через запятую и «и», имена в строчную кроме аббревиатур", () => {
  assert.equal(
    laterHint(["IP-адрес", "MAC-адрес", "Дата производства"]),
    "IP-адрес, MAC-адрес и дата производства — потом, в карточке устройства.",
  );
  assert.equal(laterHint(["IP-адрес"]), "IP-адрес — потом, в карточке устройства.");
  assert.equal(
    laterHint(["Дата производства", "IP-адрес"]),
    "Дата производства и IP-адрес — потом, в карточке устройства.",
  );
  assert.equal(laterHint([]), "");
});

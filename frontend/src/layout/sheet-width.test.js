// node --test src/layout/sheet-width.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutPathname, resolveSheetWidth } from "./sheet-width.js";

// Совпадения маршрутов в том виде, в каком их отдаёт useMatches(): корень,
// хозяин и — если открыта форма — лист со `handle.sheet`.
const matches = (...entries) => [
  { id: "root", pathname: "/", handle: undefined },
  ...entries,
];
const sheet = (pathname) => ({ pathname, handle: { sheet: { size: "md" } } });
const page = (pathname) => ({ pathname, handle: undefined });

test("ширина листа берётся из таблицы маршрутов", () => {
  assert.equal(resolveSheetWidth("/inventory/suppliers"), 1328);
  // Карточка (со слэшем) матчится раньше списка
  assert.equal(resolveSheetWidth("/inventory/suppliers/68f1a2b3c4d5e6"), 944);
  // Точное совпадение не должно ловить вложенные адреса
  assert.equal(resolveSheetWidth("/tickets"), 1328);
  assert.equal(resolveSheetWidth("/tickets/1042"), 1488);
});

test("незнакомый маршрут получает ширину по умолчанию", () => {
  assert.equal(resolveSheetWidth("/roles"), 1328);
});

test("хозяин шторки — самое глубокое совпадение без handle.sheet", () => {
  assert.equal(
    layoutPathname(
      matches(page("/inventory/suppliers"), sheet("/inventory/suppliers/add")),
    ),
    "/inventory/suppliers",
  );
});

test("форма над карточкой оставляет хозяином карточку", () => {
  assert.equal(
    layoutPathname(
      matches(
        page("/inventory/suppliers/68f1a2b3c4d5e6"),
        sheet("/inventory/suppliers/68f1a2b3c4d5e6/update"),
      ),
    ),
    "/inventory/suppliers/68f1a2b3c4d5e6",
  );
});

test("без открытой формы хозяин — сама страница", () => {
  assert.equal(
    layoutPathname(matches(page("/inventory/suppliers"))),
    "/inventory/suppliers",
  );
});

// Регрессия: форма правки открывалась в шторке над списком, а лист под ней
// сужался до ширины карточки — адрес формы начинается с «/раздел/» и его
// первой ловила строка карточки. Ширину решает хозяин, а не адрес формы.
test("форма списка не меняет ширину листа", () => {
  const lists = [
    "/inventory/suppliers",
    "/inventory/vendors",
    "/inventory/locations",
    "/inventory/device-types",
    "/inventory/device-models",
    "/ticket-templates",
    "/routine-tasks",
    "/finances/service-plans",
    "/companies",
    "/users",
    "/inventory/client-devices",
  ];
  for (const list of lists) {
    const own = resolveSheetWidth(layoutPathname(matches(page(list))));
    for (const form of [`${list}/add`, `${list}/update/68f1a2b3c4d5e6`]) {
      assert.equal(
        resolveSheetWidth(layoutPathname(matches(page(list), sheet(form)))),
        own,
        `${form} должен сохранить ширину ${list}`,
      );
    }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCrumbTrail,
  companyCrumbs,
  readCrumbState,
  crumbStateFor,
  currentCrumbAddress,
  preserveCrumbState,
} from "./crumb-trail.ts";

const list = { label: "Заявки", to: "/tickets?status=open" };
const ticket = { label: "51713", to: "/tickets/51713" };
const user = { label: "Иван Петров", to: "/users/123" };

test("полный путь сохраняет список с фильтром при переходе между разделами", () => {
  const trail = buildCrumbTrail({
    current: ticket,
    section: { ...list, to: "/tickets" },
    state: { crumbTrail: [list] },
  });
  assert.deepEqual(
    buildCrumbTrail({
      current: user,
      section: { label: "Пользователи", to: "/users" },
      state: { crumbTrail: trail },
    }),
    [list, ticket, user],
  );
});
test("переход к предку обрезает ветку и сохраняет параметры его адреса", () => {
  const state = crumbStateFor([list, ticket, user], 0);
  assert.deepEqual(buildCrumbTrail({ current: list, section: list, state }), [
    list,
  ]);
});
test("повторное открытие сущности не создаёт цикл", () => {
  assert.deepEqual(
    buildCrumbTrail({
      current: ticket,
      state: { crumbTrail: [list, ticket, user] },
    }),
    [list, ticket],
  );
});
test("прямая ссылка использует доступную иерархию и текущую сущность", () => {
  const section = { label: "Расположения", to: "/inventory/locations" };
  const parent = { label: "Офис", to: "/inventory/locations/1" };
  const current = { label: "Этаж 2", to: "/inventory/locations/2" };
  assert.deepEqual(buildCrumbTrail({ current, section, chain: [parent] }), [
    section,
    parent,
    current,
  ]);
});
test("текущий список не дублируется и недоступный раздел не становится ссылкой", () => {
  assert.deepEqual(
    buildCrumbTrail({ current: list, section: { ...list, to: "/tickets" } }),
    [list],
  );
  assert.deepEqual(
    buildCrumbTrail({ current: user, section: { label: "Пользователи" } }),
    [{ label: "Пользователи" }, user],
  );
});
test("старый state.from по-прежнему возвращает в исходную карточку", () => {
  assert.deepEqual(
    buildCrumbTrail({
      current: user,
      section: { label: "Пользователи", to: "/users" },
      state: { from: ticket },
    }),
    [ticket, user],
  );
});
test("внешние адреса, плохие подписи и повреждённый state не принимаются", () => {
  for (const state of [
    null,
    2,
    { crumbTrail: "bad" },
    { crumbTrail: [{ label: "x", to: "//evil.test" }] },
    { from: { label: "x", to: "javascript:alert(1)" } },
    { crumbTrail: [{ label: 4, to: "/tickets" }] },
    { crumbTrail: [{ label: "x", to: "/\\evil.test" }] },
  ]) {
    assert.deepEqual(readCrumbState(state), {});
  }
});
test("state пути сериализуется без потерь для reload/back/forward", () => {
  const state = JSON.parse(
    JSON.stringify(crumbStateFor([list, ticket, user], 1)),
  );
  assert.deepEqual(buildCrumbTrail({ current: ticket, state }), [list, ticket]);
});

test("переход из списка добавляет настоящих родителей выбранной сущности", () => {
  const section = { label: "Расположения", to: "/inventory/locations" };
  const parent = { label: "Офис", to: "/inventory/locations/office" };
  const current = { label: "Этаж", to: "/inventory/locations/floor" };
  assert.deepEqual(
    buildCrumbTrail({
      current,
      section,
      chain: [parent],
      state: { crumbTrail: [section] },
    }),
    [section, parent, current],
  );
});

test("шторка сохраняет query хозяина, а не пресеты формы", () => {
  assert.equal(
    currentCrumbAddress(
      "/tickets",
      { pathname: "/tickets/add", search: "?company=123", hash: "" },
      { crumbTrail: [list] },
    ),
    list.to,
  );
  assert.equal(
    currentCrumbAddress(
      "/tickets",
      { pathname: "/tickets", search: "?status=closed", hash: "#row" },
      { crumbTrail: [list] },
    ),
    "/tickets?status=closed#row",
  );
});
test("прямая ссылка на шторку не переносит пресеты в адрес фонового списка", () => {
  assert.equal(
    currentCrumbAddress(
      "/tickets",
      { pathname: "/tickets/add", search: "?company=123", hash: "" },
      undefined,
    ),
    "/tickets",
  );
});

test("смена фильтра сохраняет контекст и служебный state страницы", () => {
  const state = { crumbTrail: [list, ticket], openAction: "backToWork" };
  assert.deepEqual(preserveCrumbState(state, undefined), state);
  assert.equal(preserveCrumbState(state, null), null);
  assert.deepEqual(preserveCrumbState(state, { custom: true }), {
    custom: true,
  });
});

test("заявка в пути подписана только номером, включая сохранённый старый путь", () => {
  assert.deepEqual(
    buildCrumbTrail({
      current: user,
      state: {
        crumbTrail: [list, { label: "Заявка 51713", to: "/tickets/51713" }],
      },
    }),
    [list, { label: "51713", to: "/tickets/51713" }, user],
  );
  assert.deepEqual(
    buildCrumbTrail({
      current: { label: "Заявка 51713", to: "/tickets/51713" },
      section: list,
    }),
    [list, { label: "51713", to: "/tickets/51713" }],
  );
});

test("выбор предка сохраняет адрес его источника для существующих действий карточки", () => {
  assert.deepEqual(crumbStateFor([list, ticket, user], 1).from, list);
});

test("компания добавляется перед предками расположения и в уже сохранённый путь", () => {
  const section = { label: "Расположения", to: "/inventory/locations" };
  const company = { label: "F1Lab", to: "/companies/1" };
  const office = { label: "Офис", to: "/inventory/locations/office" };
  const current = { label: "Склад", to: "/inventory/locations/storage" };
  assert.deepEqual(
    buildCrumbTrail({
      current,
      section,
      chain: [company, office],
      state: { crumbTrail: [section, office, current] },
    }),
    [section, company, office, current],
  );
  assert.deepEqual(
    buildCrumbTrail({
      current,
      section,
      chain: [company, office],
      state: { crumbTrail: [list, ticket] },
    }),
    [list, ticket, company, office, current],
  );
});

test("компания в пути доступна по карточке только с правом чтения", () => {
  const companies = [{ _id: "c1", alias: "F1Lab" }];
  assert.deepEqual(companyCrumbs(companies, true), [
    { label: "F1Lab", to: "/companies/c1" },
  ]);
  assert.deepEqual(companyCrumbs(companies, false), [{ label: "F1Lab" }]);
});
test("несколько компаний заметки показаны общим контекстом без ложной вложенности", () => {
  assert.deepEqual(
    companyCrumbs(
      [
        { _id: "c1", alias: "F1Lab" },
        { _id: "c2", alias: "Другая компания" },
      ],
      true,
    ),
    [{ label: "F1Lab, Другая компания" }],
  );
  assert.deepEqual(companyCrumbs([], true), []);
  assert.deepEqual(companyCrumbs([{ _id: "c1" }], true), []);
});

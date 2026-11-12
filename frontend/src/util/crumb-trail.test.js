import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCrumbTrail,
  companyCrumbs,
  crumbReturnOrigin,
  crumbSourceState,
  readCrumbState,
  crumbStateFor,
  currentCrumbAddress,
  preserveCrumbState,
} from "./crumb-trail.ts";

const list = { label: "Заявки", to: "/tickets?status=open" };
const ticket = { label: "51713", to: "/tickets/51713" };
const user = { label: "Иван Петров", to: "/users/123" };

test("смена карточки сохраняет только её настоящую иерархию", () => {
  const section = { label: "Пользователи", to: "/users" };
  const company = { label: "F1Lab", to: "/companies/new" };
  assert.deepEqual(
    buildCrumbTrail({
      current: user,
      section,
      chain: [company],
      state: { crumbTrail: [list, ticket] },
    }),
    [section, company, user],
  );
});
test("переход к списку сохраняет его фильтры без прежних карточек", () => {
  assert.deepEqual(
    buildCrumbTrail({
      current: list,
      section: list,
      state: crumbStateFor([list, ticket, user], 0),
    }),
    [list],
  );
});
test("повторное открытие карточки не создаёт цикл", () => {
  assert.deepEqual(
    buildCrumbTrail({
      current: ticket,
      section: list,
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
test("старый state.from не попадает в иерархию карточки", () => {
  assert.deepEqual(
    buildCrumbTrail({
      current: user,
      section: { label: "Пользователи", to: "/users" },
      state: { from: ticket },
    }),
    [{ label: "Пользователи", to: "/users" }, user],
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
  assert.deepEqual(buildCrumbTrail({ current: ticket, section: list, state }), [
    list,
    ticket,
  ]);
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
    [user],
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

test("компания и предки расположения не зависят от старого пути", () => {
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
    [section, company, office, current],
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

test("переключение заметки строит только иерархию текущей заметки без старых компаний", () => {
  const section = { label: "База знаний", to: "/knowledge-base" };
  const oldCompany = { label: "21 век", to: "/companies/old" };
  const oldNote = { label: "Информация: Интернет", to: "/knowledge-base/old" };
  const company = { label: "Нотариус Трусова Е.А.", to: "/companies/new" };
  const current = {
    label: "Инструкции: Типовые задачи",
    to: "/knowledge-base/new",
  };
  assert.deepEqual(
    buildCrumbTrail({
      current,
      section,
      chain: [company],
      state: { crumbTrail: [section, oldCompany, oldNote], from: oldNote },
    }),
    [section, company, current],
  );
  assert.deepEqual(
    buildCrumbTrail({
      current,
      section,
      state: { from: oldNote },
    }),
    [section, current],
  );
});

test("одноимённые страницы справки с разными якорями остаются настоящими этапами", () => {
  const section = { label: "Справка", to: "/help" };
  const group = { label: "Заявки", to: "/help#tickets" };
  const current = {
    label: "Создание заявки",
    to: "/help/staff/tickets/create",
  };
  assert.deepEqual(
    buildCrumbTrail({
      current,
      section,
      chain: [group],
      state: {
        crumbTrail: [{ label: "Старая статья", to: "/help/staff/tickets/old" }],
      },
    }),
    [section, group, current],
  );
});
test("возврат к источнику отделён от иерархии и не создаёт петлю", () => {
  const items = [{ label: "Пользователи", to: "/users" }, user];
  assert.deepEqual(crumbReturnOrigin({ from: ticket }, user.to, items), ticket);
  assert.equal(crumbReturnOrigin({ from: user }, user.to, items), undefined);
  assert.equal(
    crumbReturnOrigin({ from: items[0] }, user.to, items),
    undefined,
  );
  assert.equal(
    crumbReturnOrigin(
      { from: { label: "плохой", to: "//external.test" } },
      user.to,
      items,
    ),
    undefined,
  );
});

test("переход между статьями справки не подменяет корень якорем раздела", () => {
  const section = { label: "Справка", to: "/help" };
  const group = { label: "Заявки", to: "/help#tickets" };
  const current = { label: "Новая статья", to: "/help/staff/tickets/new" };
  assert.deepEqual(
    buildCrumbTrail({
      current,
      section,
      chain: [group],
      state: {
        crumbTrail: [
          section,
          group,
          { label: "Старая статья", to: "/help/staff/tickets/old" },
        ],
      },
    }),
    [section, group, current],
  );
});

test("источник фоновой карточки сохраняется при открытии формы и после сохранения", () => {
  const hierarchy = [{ label: "Пользователи", to: "/users" }, user];
  const state = crumbSourceState(hierarchy, user, ticket);
  assert.deepEqual(state.from, user);
  assert.deepEqual(
    crumbReturnOrigin(JSON.parse(JSON.stringify(state)), user.to, hierarchy),
    ticket,
  );
  const next = { label: "Другой пользователь", to: "/users/other" };
  assert.deepEqual(crumbReturnOrigin(state, next.to, [next]), user);
});
test("повреждённый контекст возврата формы не принимается", () => {
  assert.equal(
    crumbReturnOrigin(
      {
        returnContext: {
          to: user.to,
          from: { label: "внешний", to: "//external.test" },
        },
      },
      user.to,
      [user],
    ),
    undefined,
  );
});
test("переход из якоря оглавления сохраняет корень и раздел справки", () => {
  const section = { label: "Справка", to: "/help" };
  const group = { label: "Заявки", to: "/help#tickets" };
  const current = { label: "Статья", to: "/help/staff/tickets/new" };
  assert.deepEqual(
    buildCrumbTrail({
      current,
      section,
      chain: [group],
      state: { crumbTrail: [{ label: "Справка", to: "/help#tickets" }] },
    }),
    [section, group, current],
  );
});

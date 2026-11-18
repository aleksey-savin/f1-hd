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
  companyVisitState,
  resolveCompanyCrumbs,
} from "./crumb-trail.ts";

const list = { label: "Заявки", to: "/tickets?status=open" };
const ticket = { label: "51713", to: "/tickets/51713" };
const user = { label: "Иван Петров", to: "/users/123" };

test("смена карточки сохраняет только её настоящую иерархию", () => {
  const section = { label: "Пользователи", to: "/users" };
  const company = { label: "Компания А", to: "/companies/new" };
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
  const company = { label: "Компания А", to: "/companies/1" };
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
  const companies = [{ _id: "c1", alias: "Компания А" }];
  assert.deepEqual(companyCrumbs(companies, true), [
    { label: "Компания А", companyId: "c1", to: "/companies/c1" },
  ]);
  assert.deepEqual(companyCrumbs(companies, false), [
    { label: "Компания А", companyId: "c1" },
  ]);
});
test("несколько компаний заметки показаны общим контекстом без ложной вложенности", () => {
  assert.deepEqual(
    companyCrumbs(
      [
        { _id: "c1", alias: "Компания А" },
        { _id: "c2", alias: "Другая компания" },
      ],
      true,
    ),
    [{ label: "Компания А, Другая компания" }],
  );
  assert.deepEqual(companyCrumbs([], true), []);
  assert.deepEqual(companyCrumbs([{ _id: "c1" }], true), []);
});

test("переключение заметки строит только иерархию текущей заметки без старых компаний", () => {
  const section = { label: "База знаний", to: "/knowledge-base" };
  const oldCompany = { label: "Прежняя компания", to: "/companies/old" };
  const oldNote = { label: "Информация: Интернет", to: "/knowledge-base/old" };
  const company = { label: "Компания Б", to: "/companies/new" };
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

test("подставленная компания не считается посещением, даже в старом state", () => {
  const chain = companyCrumbs([{ _id: "c1", alias: "Компания" }], true);
  const state = {
    crumbTrail: [{ label: "Компания", to: "/companies/c1" }, user],
  };
  assert.deepEqual(companyVisitState(state, user.to), []);
  assert.deepEqual(resolveCompanyCrumbs(chain, "/users", state), [
    { label: "Компания", to: "/users?companyScope=c1", freshCompanyList: true },
  ]);
});

test("реальное посещение живёт в цепочке, переживает сериализацию и не относится к другой компании", () => {
  const company = { label: "Компания", to: "/companies/c1?tab=users" };
  const first = crumbSourceState([company], company);
  const next = crumbSourceState([user], user, undefined, first);
  const state = JSON.parse(JSON.stringify(next));
  const chain = companyCrumbs([{ _id: "c1", alias: "Компания" }], true);
  assert.deepEqual(resolveCompanyCrumbs(chain, "/users", state), [company]);
  assert.deepEqual(resolveCompanyCrumbs(chain, "/users", null), [
    { label: "Компания", to: "/users?companyScope=c1", freshCompanyList: true },
  ]);
  assert.deepEqual(
    resolveCompanyCrumbs(
      companyCrumbs([{ _id: "c2", alias: "Другая" }], true),
      "/users",
      state,
    ),
    [{ label: "Другая", to: "/users?companyScope=c2", freshCompanyList: true }],
  );
  assert.deepEqual(crumbStateFor([company, user], 0, state).companyVisits, [
    company.to,
  ]);
});

test("ссылка компании проверяет доступ к назначению", () => {
  const companies = [{ _id: "c1", alias: "Компания" }];
  const noCompanyRead = companyCrumbs(companies, false);
  assert.deepEqual(resolveCompanyCrumbs(noCompanyRead, "/users"), [
    { label: "Компания", to: "/users?companyScope=c1", freshCompanyList: true },
  ]);
  assert.deepEqual(resolveCompanyCrumbs(noCompanyRead, undefined), [
    { label: "Компания" },
  ]);
  assert.deepEqual(
    resolveCompanyCrumbs(noCompanyRead, "/users", {
      companyVisits: ["/companies/c1"],
    }),
    [{ label: "Компания" }],
  );
  assert.deepEqual(
    resolveCompanyCrumbs(companyCrumbs(companies, true), undefined, {
      companyVisits: ["/companies/c1"],
    }),
    [{ label: "Компания", to: "/companies/c1" }],
  );
});

test("источник с другими фильтрами не исчезает из-за ссылки компании на тот же список", () => {
  const origin = { label: "Пользователи", to: "/users?search=Иван" };
  assert.deepEqual(
    crumbReturnOrigin({ from: origin }, user.to, [
      {
        label: "Компания",
        to: "/users?companyScope=c1",
        freshCompanyList: true,
      },
      user,
    ]),
    origin,
  );
});

test("недостоверные адреса посещений игнорируются", () => {
  assert.deepEqual(
    companyVisitState(
      { companyVisits: ["//evil.test", "/users/123", "/companies/add"] },
      user.to,
    ),
    [],
  );
});

test("исходная выборка проходит через карточку, предка и сериализацию", () => {
  const listSnapshot = {
    path: "/users",
    values: { searchTerm: "Иван", page: 3 },
  };
  const source = { label: "Пользователи", to: "/users", listSnapshot };
  const state = JSON.parse(JSON.stringify(crumbSourceState([source], source)));
  const items = buildCrumbTrail({
    current: user,
    section: { label: "Пользователи", to: "/users" },
    state,
  });
  assert.deepEqual(items[0].listSnapshot, listSnapshot);
  assert.deepEqual(crumbStateFor(items, 0).listSnapshot, listSnapshot);
  assert.deepEqual(readCrumbState(state).from.listSnapshot, listSnapshot);
  const fresh = { label: "Компания", to: "/users?companyScope=c1" };
  assert.equal(crumbStateFor([fresh, user], 0).listSnapshot, undefined);
});

test("повторный выбор компании не наследует поиск из списка той же компании", () => {
  const source = {
    label: "Пользователи",
    to: "/users?companyScope=c1",
    listSnapshot: { path: "/users", values: { searchTerm: "Иван", page: 4 } },
  };
  const state = crumbSourceState([source], source);
  const chain = resolveCompanyCrumbs(
    companyCrumbs([{ _id: "c1", alias: "Компания" }], true),
    "/users",
    state,
  );
  const items = buildCrumbTrail({
    current: user,
    section: { label: "Пользователи", to: "/users" },
    chain,
    state,
  });
  const company = items.find((item) => item.label === "Компания");
  assert.equal(company.listSnapshot, undefined);
  assert.equal(
    crumbStateFor(items, items.indexOf(company)).listSnapshot,
    undefined,
  );
  assert.deepEqual(crumbReturnOrigin(state, user.to, [company, user]), source);
});

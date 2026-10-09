// node --test services/externalApi.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;

const {
  apiApplicantFilters,
  asString,
  companyLogLinkedUser,
  companyLogUserFilters,
  externalTicketDoc,
  externalTicketResponse,
  resolveApiApplicant,
  resolveApiCategoryId,
  resolveCompanyLogUser,
} = require("./externalApi");

/**
 * Ключ компании действует только в своей компании: люди ищутся в ней одной,
 * значения из тела — строками, ответственных и срок тело не задаёт, в ответах
 * нет почты. «База» — массив, фильтры сопоставляются по правилам Mongo (sift).
 */

const KEY_COMPANY = "66aa000000000000000000c1";
const OTHER_COMPANY = "66aa000000000000000000c2";

const users = [
  { _id: "66aa000000000000000000a1", email: "anna@romashka.ru", firstName: "Анна", lastName: "Петрова", company: { _id: KEY_COMPANY }, activeDirectoryObjectGUID: "guid-anna" },
  { _id: "66aa000000000000000000a2", email: "gone@romashka.ru", firstName: "Олег", lastName: "Уволен", company: { _id: KEY_COMPANY }, banned: true },
  { _id: "66aa000000000000000000b1", email: "boss@other.ru", firstName: "Борис", lastName: "Чужой", company: { _id: OTHER_COMPANY }, activeDirectoryObjectGUID: "guid-boss" },
  { _id: "66aa000000000000000000f1", email: "admin@f1lab.ru", firstName: "Админ", lastName: "Наш", company: { _id: "66aa000000000000000000f0" }, isEndUser: false },
];

const fakeFinder = () => {
  const seen = [];
  const findUser = async (filter) => {
    seen.push(filter);
    return users.find(sift(filter)) || null;
  };
  return { findUser, seen };
};

test("values from the body are strings; objects and arrays are dropped", () => {
  assert.equal(asString("  a@b.c "), "a@b.c");
  assert.equal(asString(42), "42");
  for (const value of [{ $ne: null }, ["a@b.c"], null, undefined, true]) {
    assert.equal(asString(value), "");
  }
});

test("applicant filters are always scoped to the key's company", () => {
  const filters = apiApplicantFilters({
    companyId: KEY_COMPANY,
    userId: "66aa000000000000000000a1",
    userEmail: " Anna@Romashka.RU ",
  });

  assert.deepEqual(filters, [
    { _id: "66aa000000000000000000a1", "company._id": KEY_COMPANY },
    { email: "anna@romashka.ru", "company._id": KEY_COMPANY, banned: { $ne: true } },
  ]);
  assert.deepEqual(apiApplicantFilters({ companyId: null, userEmail: "anna@romashka.ru" }), []);
});

test("operator objects and junk ids never become filters", () => {
  assert.deepEqual(
    apiApplicantFilters({
      companyId: KEY_COMPANY,
      userId: { $ne: null },
      userEmail: { $regex: ".*" },
    }),
    [],
  );
  assert.deepEqual(
    apiApplicantFilters({ companyId: KEY_COMPANY, userId: "not-an-id" }),
    [],
  );
});

test("an applicant is found by id or e-mail inside the key's company", async () => {
  const byId = fakeFinder();
  assert.equal(
    (await resolveApiApplicant({ companyId: KEY_COMPANY, userId: "66aa000000000000000000a1" }, byId)).firstName,
    "Анна",
  );

  const byEmail = fakeFinder();
  assert.equal(
    (await resolveApiApplicant({ companyId: KEY_COMPANY, userEmail: "ANNA@romashka.ru" }, byEmail)).firstName,
    "Анна",
  );

  // Устаревший id, верная почта — находит по почте
  const fallthrough = fakeFinder();
  const found = await resolveApiApplicant(
    { companyId: KEY_COMPANY, userId: "66aa0000000000000000dead", userEmail: "anna@romashka.ru" },
    fallthrough,
  );
  assert.equal(found.firstName, "Анна");
  assert.equal(fallthrough.seen.length, 2);
});

test("people of other companies and staff are never resolved", async () => {
  for (const request of [
    { userId: "66aa000000000000000000b1" },
    { userEmail: "boss@other.ru" },
    { userId: "66aa000000000000000000f1" },
    { userEmail: "admin@f1lab.ru" },
    { userEmail: "gone@romashka.ru" },
    { userEmail: { $ne: null } },
  ]) {
    const finder = fakeFinder();
    assert.equal(
      await resolveApiApplicant({ companyId: KEY_COMPANY, ...request }, finder),
      null,
      JSON.stringify(request),
    );
    for (const filter of finder.seen) {
      assert.equal(filter["company._id"], KEY_COMPANY);
    }
  }
});

test("category: only an existing category by a real id", async () => {
  const known = "66aa000000000000000000e1";
  const categoryExists = async (id) => (id === known ? { _id: id } : null);

  assert.equal(await resolveApiCategoryId(known, { categoryExists }), known);
  assert.equal(await resolveApiCategoryId("66aa000000000000000000e2", { categoryExists }), null);
  for (const bad of ["", "x", { $ne: null }, [known], undefined]) {
    assert.equal(await resolveApiCategoryId(bad, { categoryExists }), null);
  }
});

test("ticket fields: key company, no responsibles, deadline from settings", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const doc = externalTicketDoc({
    body: {
      title: "Не печатает принтер",
      description: "",
      responsibles: ["66aa000000000000000000f1"],
      deadline: "2020-01-01",
      customFields: [{ name: "Кабинет", value: "12" }, { value: "без имени" }],
      source: "Сайт",
    },
    applicant: { _id: "66aa000000000000000000a1", company: { _id: OTHER_COMPANY } },
    company: { _id: KEY_COMPANY, alias: "Ромашка", fullTitle: "ООО «Ромашка»" },
    categoryId: null,
    attachments: [],
    deadlineHours: 24,
    now,
  });

  assert.deepEqual(doc.responsibles, []);
  assert.equal(doc.deadline.toISOString(), "2026-10-01T10:00:00.000Z");
  assert.deepEqual(doc.company, { _id: KEY_COMPANY, alias: "Ромашка" });
  assert.equal(doc.categoryId, null);
  assert.deepEqual(doc.customFields, [{ name: "Кабинет", value: "12" }]);
  assert.equal(doc.source, "Сайт");
  assert.equal(doc.applicantId, "66aa000000000000000000a1");
  assert.equal(doc.createdBy, "66aa000000000000000000a1");
});

test("ticket response carries no e-mail", () => {
  const response = externalTicketResponse({
    ticket: { _id: "t1", num: 51713, title: "t", description: "", state: "Новая", createdAt: new Date(), deadline: new Date() },
    applicant: users[0],
    company: { _id: KEY_COMPANY, alias: "Ромашка" },
  });

  assert.deepEqual(response.ticket.applicant, {
    _id: "66aa000000000000000000a1",
    firstName: "Анна",
    lastName: "Петрова",
  });
  assert.doesNotMatch(JSON.stringify(response), /@/);
});

test("company log: user by GUID, then e-mail, only inside the key's company", async () => {
  assert.deepEqual(
    companyLogUserFilters({ companyId: KEY_COMPANY, activeDirectoryObjectGUID: " guid-anna ", email: "Anna@Romashka.ru" }),
    [
      { activeDirectoryObjectGUID: "guid-anna", "company._id": KEY_COMPANY },
      { email: "anna@romashka.ru", "company._id": KEY_COMPANY },
    ],
  );

  const own = await resolveCompanyLogUser(
    { companyId: KEY_COMPANY, activeDirectoryObjectGUID: "guid-anna" },
    fakeFinder(),
  );
  assert.equal(own.firstName, "Анна");

  const byEmail = await resolveCompanyLogUser(
    { companyId: KEY_COMPANY, activeDirectoryObjectGUID: "unknown-guid", email: "anna@romashka.ru" },
    fakeFinder(),
  );
  assert.equal(byEmail.firstName, "Анна");

  for (const request of [
    { activeDirectoryObjectGUID: "guid-boss" },
    { activeDirectoryObjectGUID: "x", email: "boss@other.ru" },
    { activeDirectoryObjectGUID: { $ne: null } },
  ]) {
    assert.equal(
      await resolveCompanyLogUser({ companyId: KEY_COMPANY, ...request }, fakeFinder()),
      null,
      JSON.stringify(request),
    );
  }
});

test("company log response: linked user without e-mail", () => {
  assert.deepEqual(companyLogLinkedUser(users[0]), {
    id: "66aa000000000000000000a1",
    firstName: "Анна",
    lastName: "Петрова",
  });
  assert.equal(companyLogLinkedUser(null), null);
});

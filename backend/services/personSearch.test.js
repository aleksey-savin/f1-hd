// node --test services/personSearch.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { personSearchClauses } = require("./personSearch");

const FIELDS = ["firstName", "lastName", "email", "phone"];
// «поле:регулярка» каждого условия внутри $or
const sources = (clause) =>
  clause.$or.map((condition) => {
    const [field, pattern] = Object.entries(condition)[0];
    return `${field}:${pattern.source}`;
  });

test("a query that looks like a number searches the phone by digits, once", () => {
  const clauses = personSearchClauses("+7 (914) 555", FIELDS, 6);
  assert.equal(clauses.length, 1);
  assert.deepEqual(sources(clauses[0]), ["phone:7914555"]);
});

test("a leading 8 also tries 7", () => {
  assert.deepEqual(sources(personSearchClauses("8 914 555 01 42", FIELDS, 6)[0]), [
    "phone:89145550142",
    "phone:79145550142",
  ]);
});

test("words go to text fields, their digits to the phone", () => {
  const clauses = personSearchClauses("Соколова 555-01", FIELDS, 6);
  assert.equal(clauses.length, 2);
  assert.deepEqual(sources(clauses[0]), ["firstName:Соколова", "lastName:Соколова", "email:Соколова"]);
  assert.deepEqual(sources(clauses[1]), ["firstName:555-01", "lastName:555-01", "email:555-01", "phone:55501"]);
});

test("the number of words is capped; an empty query gives no conditions", () => {
  assert.equal(personSearchClauses("a b c d e f g h", FIELDS, 6).length, 6);
  assert.deepEqual(personSearchClauses("   ", FIELDS, 6), []);
});

test("without a phone field a number is plain text", () => {
  assert.deepEqual(sources(personSearchClauses("914", ["firstName"], 4)[0]), ["firstName:914"]);
});

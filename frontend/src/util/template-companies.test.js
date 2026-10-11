// node --test src/util/template-companies.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { templateCompanies, templateHasCompany } from "./template-companies.ts";

const romashka = { _id: "000000000000000000000001", alias: "Ромашка" };
const vasilek = { _id: "000000000000000000000002", alias: "Василёк" };

test("a template filed for a company counts even when shared with nobody", () => {
  const template = { company: romashka, sharedCompanies: [] };
  assert.deepEqual(templateCompanies(template), [romashka]);
  assert.equal(templateHasCompany(template, [romashka._id]), true);
});

test("the own company and the shared ones are listed once each", () => {
  const template = { company: vasilek, sharedCompanies: [vasilek, romashka] };
  assert.deepEqual(templateCompanies(template), [vasilek, romashka]);
});

test("a template without companies matches no company filter", () => {
  assert.deepEqual(templateCompanies({}), []);
  assert.deepEqual(templateCompanies({ company: null }), []);
  assert.equal(templateHasCompany({}, [vasilek._id]), false);
});

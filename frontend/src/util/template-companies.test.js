// node --test src/util/template-companies.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { templateCompanies, templateHasCompany } from "./template-companies.ts";

const autogarant = { _id: "62d0c0ed5a3314d41cc43ef3", alias: "Автогарант" };
const uspeh = { _id: "62eb2e2e123d238ba1661dea", alias: "Успех" };

test("a template filed for a company counts even when shared with nobody", () => {
  const template = { company: autogarant, sharedCompanies: [] };
  assert.deepEqual(templateCompanies(template), [autogarant]);
  assert.equal(templateHasCompany(template, [autogarant._id]), true);
});

test("the own company and the shared ones are listed once each", () => {
  const template = { company: uspeh, sharedCompanies: [uspeh, autogarant] };
  assert.deepEqual(templateCompanies(template), [uspeh, autogarant]);
});

test("a template without companies matches no company filter", () => {
  assert.deepEqual(templateCompanies({}), []);
  assert.deepEqual(templateCompanies({ company: null }), []);
  assert.equal(templateHasCompany({}, [uspeh._id]), false);
});

require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");
const Location = require("../../models/inventory/location");
const { locationValidation } = require("./location");
const OWN = "aaaaaaaaaaaaaaaaaaaaaaaa", FOREIGN = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ID = "cccccccccccccccccccccccc", PARENT = "dddddddddddddddddddddddd";
for (const scenario of ["parent only", "company only", "same company"]) {
  test(`location validates effective company and parent: ${scenario}`, async (t) => {
    t.mock.method(Location, "findById", async id => String(id) === ID
      ? { _id: ID, company: OWN, parent: PARENT }
      : { _id: PARENT, company: scenario === "parent only" ? FOREIGN : OWN });
    const req = { params: { id: ID }, body: { name: "Room", type: "room",
      ...(scenario === "company only" ? { company: FOREIGN } : { parent: PARENT }) } };
    for (const validator of locationValidation) await validator.run(req);
    assert.equal(validationResult(req).isEmpty(), scenario === "same company");
  });
}

for (const scenario of ["missing", "cycle", "new same company"]) {
  test(`location hierarchy still handles ${scenario} parents`, async (t) => {
    t.mock.method(Location, "findById", async id => {
      if (scenario === "missing") return null;
      return String(id) === ID ? { _id: ID, company: OWN }
        : { _id: PARENT, company: OWN, parent: scenario === "cycle" ? ID : null };
    });
    const req = { params: scenario === "new same company" ? {} : { id: ID },
      body: { name: "Room", type: "room", company: OWN, parent: PARENT } };
    for (const validator of locationValidation) await validator.run(req);
    assert.equal(validationResult(req).isEmpty(), scenario === "new same company");
  });
}

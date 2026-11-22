require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const Configuration = require("@/models/inventory/deviceConfiguration");
const Model = require("@/models/inventory/deviceModel");
const controller = require("./deviceConfiguration");
const SOURCE = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TARGET = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ID = "cccccccccccccccccccccccc";
for (const target of [SOURCE, TARGET]) {
  test(`configuration update ${target === SOURCE ? "keeps" : "cannot change"} model ownership`, async (t) => {
    let saved = 0;
    const document = { _id: ID, deviceModelId: SOURCE, save: async () => { saved++; } };
    t.mock.method(Configuration, "findOne", async () => document);
    t.mock.method(Model, "findById", async () => ({ _id: target, multiConfig: false }));
    const query = { populate: () => query, then: (resolve) => Promise.resolve(document).then(resolve) };
    t.mock.method(Configuration, "findById", () => query);
    let error;
    await controller.update({ params: { id: ID }, body: { deviceModelId: target } },
      { status() { return this; }, json() {} }, e => { error = e; });
    if (target === SOURCE) {
      assert.ifError(error);
      assert.equal(saved, 1);
    } else {
      assert.equal(error?.statusCode, 409);
      assert.equal(saved, 0);
      assert.equal(document.deviceModelId, SOURCE);
    }
  });
}

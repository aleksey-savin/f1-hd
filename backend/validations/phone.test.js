// node --test validations/phone.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const { phoneBody, phoneListBody, PHONE_MESSAGE } = require("./phone");

const run = async (chain, body) => {
  const req = { body, params: {}, query: {}, headers: {}, cookies: {} };
  await chain.run(req);
  return { body: req.body, errors: validationResult(req).array().map((error) => error.msg) };
};

test("a phone from the web or from an old tab is stored as digits", async () => {
  for (const sent of ["+79145550142", "+7 (914) 555-01-42", "8 914 555 01 42", "89145550142"]) {
    const { body, errors } = await run(phoneBody("phone"), { phone: sent });
    assert.deepEqual(errors, [], sent);
    assert.equal(body.phone, "79145550142", sent);
  }
});

test("an empty phone clears the field, a missing one is left alone", async () => {
  assert.equal((await run(phoneBody("phone"), { phone: "" })).body.phone, "");
  assert.equal((await run(phoneBody("phone"), { phone: "+7" })).body.phone, "");
  assert.equal("phone" in (await run(phoneBody("phone"), {})).body, false);
});

test("incomplete numbers and numbers without an area code are refused", async () => {
  for (const sent of ["+7 (914) 555-0", "222-29-99", "+37529", "тел 12"]) {
    assert.deepEqual((await run(phoneBody("phone"), { phone: sent })).errors, [PHONE_MESSAGE], sent);
  }
});

test("nested paths work (settings contacts)", async () => {
  const { body, errors } = await run(phoneBody("contacts.tel"), { contacts: { tel: "+7 (423) 200-00-00" } });
  assert.deepEqual(errors, []);
  assert.equal(body.contacts.tel, "74232000000");
});

test("company phones: normalized, emptied rows and repeats dropped", async () => {
  const { body, errors } = await run(phoneListBody("phones"), {
    phones: ["+7 (423) 222-29-99", "", "+7", "8 423 222 29 99", "+375 29 123-45-67"],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(body.phones, ["74232222999", "375291234567"]);
});

test("company phones: the legacy single string still works, a bad item is refused", async () => {
  assert.deepEqual((await run(phoneListBody("phones"), { phones: "+7 (423) 222-29-99" })).body.phones, ["74232222999"]);
  assert.deepEqual((await run(phoneListBody("phones"), { phones: ["+7 (423) 222-29-99", 42] })).errors, [PHONE_MESSAGE]);
  assert.deepEqual((await run(phoneListBody("phones"), { phones: ["+7 (423) 222-2"] })).errors, [PHONE_MESSAGE]);
});

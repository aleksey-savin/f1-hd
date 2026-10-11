const test = require("node:test");
const assert = require("node:assert/strict");

const { mailContactLine } = require("./mailContactLine");

test("mailContactLine: с телефоном — звонок или ответное письмо", () => {
  assert.equal(
    mailContactLine({ contacts: { tel: "74950000000" } }),
    "Если у Вас есть вопросы или дополнительная информация, пожалуйста, позвоните нам по номеру +7 (495) 000-00-00 или отправьте ответное письмо (только не меняйте тему).",
  );
});

test("mailContactLine: без телефона фраза о звонке исчезает", () => {
  const expected =
    "Если у Вас есть вопросы или дополнительная информация, пожалуйста, отправьте ответное письмо (только не меняйте тему).";
  for (const preferences of [null, undefined, {}, { contacts: {} }, { contacts: { tel: "" } }, { contacts: { tel: "   " } }, { contacts: { tel: null } }]) {
    assert.equal(mailContactLine(preferences), expected);
  }
});

test("mailContactLine: телефон из старых данных не становится разметкой", () => {
  const line = mailContactLine({ contacts: { tel: "<b>222</b>" } });
  assert.equal(line.includes("<b>"), false);
  assert.ok(line.includes("позвоните нам по номеру"));
});

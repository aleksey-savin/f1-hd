// node --test scripts/seedBrand.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { planBrandSeed } = require("./seedBrand");

const env = { LEGACY_BRAND_NAME: "Прежний портал", LEGACY_BRAND_SIGNATURE: "С уважением,<br>Прежняя команда" };

test("работающая установка без бренда получает прежние название и подпись", () => {
  const plan = planBrandSeed({ preferences: { _id: 1 }, users: 12, env });
  assert.deepEqual(plan.set, {
    "brand.productName": "Прежний портал",
    "brand.mailSignature": "С уважением,\nПрежняя команда",
  });
});

test("перевод строки в подписи принимается и как \\n двумя знаками", () => {
  const plan = planBrandSeed({
    preferences: { _id: 1, brand: {} },
    users: 1,
    env: { ...env, LEGACY_BRAND_SIGNATURE: "С уважением,\\nКоманда" },
  });
  assert.equal(plan.set["brand.mailSignature"], "С уважением,\nКоманда");
});

test("свежая установка не трогается: нет настроек или нет пользователей", () => {
  assert.equal(planBrandSeed({ preferences: null, users: 5, env }).set, null);
  assert.equal(planBrandSeed({ preferences: { _id: 1 }, users: 0, env }).set, null);
});

test("заданное название портала не перезаписывается (повторный запуск)", () => {
  const plan = planBrandSeed({ preferences: { _id: 1, brand: { productName: "Своё" } }, users: 3, env });
  assert.equal(plan.set, null);
});

test("без переменных ничего не пишется, и об этом сказано", () => {
  for (const empty of [{}, { LEGACY_BRAND_NAME: "  ", LEGACY_BRAND_SIGNATURE: "" }]) {
    const plan = planBrandSeed({ preferences: { _id: 1 }, users: 3, env: empty });
    assert.equal(plan.set, null);
    assert.match(plan.lines.join("\n"), /не заданы — ничего не записано/);
  }
});

test("задана одна переменная — пишется только она", () => {
  const onlyName = planBrandSeed({ preferences: { _id: 1 }, users: 3, env: { LEGACY_BRAND_NAME: "Портал" } });
  assert.deepEqual(onlyName.set, { "brand.productName": "Портал" });

  const onlySignature = planBrandSeed({ preferences: { _id: 1 }, users: 3, env: { LEGACY_BRAND_SIGNATURE: "Команда" } });
  assert.deepEqual(onlySignature.set, { "brand.mailSignature": "Команда" });
});

test("подпись, уже заданная в настройках, не затирается", () => {
  const plan = planBrandSeed({ preferences: { _id: 1, brand: { mailSignature: "Своя" } }, users: 3, env });
  assert.deepEqual(plan.set, { "brand.productName": "Прежний портал" });
});

test("слишком длинное значение — ошибка, а не обрезка", () => {
  const plan = planBrandSeed({ preferences: { _id: 1 }, users: 3, env: { LEGACY_BRAND_NAME: "я".repeat(41) } });
  assert.match(plan.error, /40/);
  assert.equal(plan.set, undefined);
});

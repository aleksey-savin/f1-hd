const test = require("node:test");
const assert = require("node:assert/strict");

const callSummary = require("./callSummary");
const transcription = require("./transcription");

// Следы прежней установки: ни название, ни её примеры искажений в промптах жить не должны.
// Прежнее название собрано из частей: страж репозитория (scripts/repoBrand.test.js) ищет его целиком.
const LEFTOVERS = [["F1", "Lab"].join(""), "Фатима", "эф один лаб"];

const assertNoLeftovers = (text) => {
  for (const leftover of LEFTOVERS) {
    assert.ok(!text.includes(leftover), `в промпте остался след «${leftover}»`);
  }
};

test("callSummary: название организации приходит из контекста", () => {
  const { system, user } = callSummary({
    segments: [],
    context: { supportCompany: "Ромашка" },
  });

  assert.ok(system.includes("Наша компания (служба поддержки) называется «Ромашка»"));
  assert.ok(system.includes("всегда исправляй на «Ромашка»"));
  assert.equal(JSON.parse(user).known.supportCompany, "Ромашка");
  assertNoLeftovers(system);
  assertNoLeftovers(user);
});

test("callSummary: без названия предложение о компании опускается", () => {
  for (const context of [undefined, {}, { supportCompany: "" }, { supportCompany: "   " }]) {
    const { system, user } = callSummary({ segments: [], context });

    assert.ok(
      !system.split("\n").some((line) => line.startsWith("Наша компания")),
      "предложение о компании осталось без названия",
    );
    assert.ok(!system.includes("«»"), "в промпте пустые кавычки");
    assert.ok(!system.includes("undefined"));
    assert.equal(JSON.parse(user).known.supportCompany, "");
    assertNoLeftovers(system);
    assertNoLeftovers(user);
  }
});

test("callSummary: остальные известные данные и сегменты не теряются", () => {
  const { system, user } = callSummary({
    segments: [{ speaker: "1", text: "Добрый день", start: 0, end: 1 }],
    context: {
      supportCompany: " Ромашка ",
      applicantName: "Анна",
      companyName: "Лютик",
      operatorName: "Олег",
    },
  });

  assert.ok(system.includes("«Ромашка»"));
  assert.deepEqual(JSON.parse(user).known, {
    supportCompany: "Ромашка",
    operator: "Олег",
    caller: "Анна",
    company: "Лютик",
  });
  assert.deepEqual(JSON.parse(user).segments, [{ speaker: "1", text: "Добрый день" }]);
});

test("transcription: название организации подставляется один раз", () => {
  const prompt = transcription({ supportCompany: "Ромашка" });

  assert.equal(prompt.split("техподдержки Ромашка").length - 1, 1);
  assert.ok(prompt.includes("службы техподдержки Ромашка."));
  assert.ok(!prompt.includes("поддержки поддержки"));
  assert.ok(!prompt.includes("  "));
  assertNoLeftovers(prompt);
});

test("transcription: без названия фраза заканчивается на службе техподдержки", () => {
  for (const args of [undefined, {}, { supportCompany: "" }, { supportCompany: "  " }]) {
    const prompt = transcription(args);

    assert.ok(prompt.includes("службы техподдержки."));
    assert.ok(!prompt.includes("поддержки поддержки"));
    assert.ok(!prompt.includes("  "), "в промпте двойной пробел");
    assert.ok(!prompt.includes("undefined"));
    assertNoLeftovers(prompt);
  }
});

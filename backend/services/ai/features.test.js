// node --test services/ai/features.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAiFeatures, AI_FEATURE_LABELS } = require("./features");

const KEYS = Object.keys(AI_FEATURE_LABELS);

test("без главного рубильника не работает ни одна функция", () => {
  const states = resolveAiFeatures({
    isActive: false,
    features: { category: true, title: true, guide: true, terms: true, feedback: true },
    speechToText: { isActive: true, callSummary: true },
  });

  for (const key of KEYS) assert.equal(states[key], false, key);
});

test("старая установка без флагов функций ничего не теряет", () => {
  const states = resolveAiFeatures({ isActive: true });

  assert.equal(states.category, true);
  assert.equal(states.title, true);
  assert.equal(states.guide, true);
  assert.equal(states.terms, true);
  assert.equal(states.feedback, true);
  // Расшифровка по-прежнему опциональна: её рубильник был выключен по умолчанию
  assert.equal(states.speechToText, false);
  assert.equal(states.callSummary, false);
});

test("функция выключается своим флагом, не трогая соседей", () => {
  const states = resolveAiFeatures({
    isActive: true,
    features: { guide: false },
    speechToText: { isActive: true },
  });

  assert.equal(states.guide, false);
  assert.equal(states.terms, true);
  assert.equal(states.speechToText, true);
  assert.equal(states.callSummary, true);
});

test("описание из записи звонка работает только поверх расшифровки", () => {
  assert.equal(
    resolveAiFeatures({
      isActive: true,
      speechToText: { isActive: false, callSummary: true },
    }).callSummary,
    false,
  );
  assert.equal(
    resolveAiFeatures({
      isActive: true,
      speechToText: { isActive: true, callSummary: false },
    }).callSummary,
    false,
  );
});

test("пустые настройки — всё выключено", () => {
  const states = resolveAiFeatures(undefined);
  for (const key of KEYS) assert.equal(states[key], false, key);
});

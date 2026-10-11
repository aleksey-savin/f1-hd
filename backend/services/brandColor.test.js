// node --test services/brandColor.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { contrast, accentTokens, isHexColor, DEFAULT_ACCENT } = require("./brandColor");

const SAMPLES = ["#00bc8c", "#2f7fd6", "#ffffff", "#000000", "#ffff00", "#d6336c"];

test("contrast: чёрный на белом — 21, цвет сам с собой — 1, порядок не важен", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(contrast("#00bc8c", "#00bc8c"), 1);
  assert.equal(contrast("#ffffff", "#00bc8c"), contrast("#00bc8c", "#ffffff"));
  assert.ok(contrast("#00bc8c", "#ffffff") >= 1);
});

test("isHexColor: только #rrggbb", () => {
  for (const good of ["#00bc8c", "#00BC8C", "#ffffff"]) assert.equal(isHexColor(good), true);
  for (const bad of ["#fff", "00bc8c", "#00bc8g", null, undefined, 123, "", " #00bc8c", "#00bc8c\n"]) {
    assert.equal(isHexColor(bad), false, String(bad));
  }
});

test("accentTokens: бирюза по умолчанию оставляет белый текст на кнопке", () => {
  const tokens = accentTokens("#00bc8c");
  assert.equal(tokens.primary, "#00bc8c");
  assert.equal(tokens.primaryForeground, "#ffffff");
});

test("accentTokens: на светлом акценте текст тёмный", () => {
  assert.equal(accentTokens("#ffff00").primaryForeground, "#1d2227");
  assert.equal(accentTokens("#ffffff").primaryForeground, "#1d2227");
  assert.equal(accentTokens("#000000").primaryForeground, "#ffffff");
});

test("accentTokens: текст акцента читается в обеих темах при любом цвете", () => {
  for (const accent of SAMPLES) {
    const tokens = accentTokens(accent);
    assert.deepEqual(Object.keys(tokens).sort(), [
      "accentTextDark",
      "accentTextLight",
      "primary",
      "primaryForeground",
    ]);
    for (const value of Object.values(tokens)) assert.equal(isHexColor(value), true, `${accent} → ${value}`);
    assert.ok(contrast(tokens.accentTextLight, "#ffffff") >= 4.5, `${accent} light ${tokens.accentTextLight}`);
    assert.ok(contrast(tokens.accentTextDark, "#1d2024") >= 4.5, `${accent} dark ${tokens.accentTextDark}`);
  }
});

test("accentTokens: уже контрастный цвет не меняется", () => {
  // тёмно-синий читается на белом, светло-жёлтый — на тёмном
  assert.equal(accentTokens("#1a3c8a").accentTextLight, "#1a3c8a");
  assert.equal(accentTokens("#ffff00").accentTextDark, "#ffff00");
});

test("accentTokens: регистр приводится, мусор заменяется цветом по умолчанию", () => {
  assert.equal(accentTokens("#00BC8C").primary, "#00bc8c");
  assert.deepEqual(accentTokens("red"), accentTokens(DEFAULT_ACCENT));
  assert.deepEqual(accentTokens(null), accentTokens(DEFAULT_ACCENT));
  assert.equal(DEFAULT_ACCENT, "#00bc8c");
});

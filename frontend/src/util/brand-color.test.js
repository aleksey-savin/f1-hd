// node --test src/util/brand-color.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ACCENT,
  accentTokens,
  contrast,
  isHexColor,
} from "./brand-color.js";

// Общие примеры с backend/services/brandColor.js: разойдутся — письмо и экран
// покрасятся по-разному
const VECTORS = [
  ["#00bc8c", "#008462", "#00bc8c", "#ffffff"],
  ["#2f7fd6", "#2877cd", "#4089d9", "#ffffff"],
  ["#ffffff", "#757575", "#ffffff", "#1d2227"],
  ["#000000", "#000000", "#878787", "#ffffff"],
  ["#ffff00", "#7a7a00", "#ffff00", "#1d2227"],
  ["#d6336c", "#d6336c", "#de5988", "#ffffff"],
];

test("токены акцента совпадают с серверными", () => {
  for (const [accent, light, dark, onAccent] of VECTORS) {
    const tokens = accentTokens(accent);
    assert.equal(tokens.primary, accent);
    assert.equal(tokens.accentTextLight, light, `${accent}: светлая тема`);
    assert.equal(tokens.accentTextDark, dark, `${accent}: тёмная тема`);
    assert.equal(tokens.primaryForeground, onAccent, `${accent}: текст на акценте`);
  }
});

test("текст цвета акцента читается на обоих фонах при любом цвете", () => {
  for (const [accent] of VECTORS) {
    const tokens = accentTokens(accent);
    assert.ok(contrast(tokens.accentTextLight, "#ffffff") >= 4.5);
    assert.ok(contrast(tokens.accentTextDark, "#1d2024") >= 4.5);
  }
});

test("не цвет заменяется цветом по умолчанию, регистр приводится к нижнему", () => {
  assert.equal(accentTokens("красный").primary, DEFAULT_ACCENT);
  assert.equal(accentTokens(undefined).primary, DEFAULT_ACCENT);
  assert.equal(accentTokens("#2F7FD6").primary, "#2f7fd6");
});

test("контраст симметричен и лежит между 1 и 21", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast("#123456", "#123456"), 1);
});

test("isHexColor принимает только #rrggbb", () => {
  assert.equal(isHexColor("#00bc8c"), true);
  assert.equal(isHexColor("#00BC8C"), true);
  assert.equal(isHexColor("#0b8"), false);
  assert.equal(isHexColor("00bc8c"), false);
  assert.equal(isHexColor(null), false);
});

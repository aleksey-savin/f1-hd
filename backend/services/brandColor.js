/**
 * Цвет акцента → токены интерфейса и писем.
 *
 * Один цвет из настроек («Бренд») красит кнопки, ссылки и письма согласования.
 * Ни один цвет не отвергается: вместо отказа под него подбираются читаемые
 * пары — текст на кнопке и текст цвета акцента на светлом и тёмном фоне.
 *
 * ТА ЖЕ МАТЕМАТИКА живёт во фронтенде (`frontend/src/util/brand-color.js`):
 * правка здесь без правки там разведёт письмо и экран. Сверяются общими
 * примерами в тестах.
 */

const DEFAULT_ACCENT = "#00bc8c";

// Фоны, на которых читается текст цвета акцента (светлая и тёмная темы)
const LIGHT_BACKGROUND = "#ffffff";
const DARK_BACKGROUND = "#1d2024";

// Текст на самом акценте: белый, пока не падает ниже 2.2:1 (бирюза по
// умолчанию даёт 2.45:1 и остаётся с белым), иначе тёмный
const ON_ACCENT_LIGHT = "#ffffff";
const ON_ACCENT_DARK = "#1d2227";
const ON_ACCENT_MIN_CONTRAST = 2.2;

const TEXT_MIN_CONTRAST = 4.5;
const LIGHTNESS_STEP = 0.01;
const MAX_STEPS = 100;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const isHexColor = (value) => typeof value === "string" && HEX_COLOR.test(value);

const toRgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

const toHex = (rgb) =>
  "#" +
  rgb
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

// Относительная яркость по WCAG 2.x
const luminance = (hex) => {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Контраст двух цветов #rrggbb по WCAG: число от 1 до 21, порядок не важен. */
const contrast = (hexA, hexB) => {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const toHsl = (hex) => {
  const [r, g, b] = toRgb(hex).map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h;
  if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return [h / 6, s, l];
};

const hueToChannel = (p, q, t) => {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
};

const fromHsl = ([h, s, l]) => {
  if (s === 0) return toHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return toHex([
    hueToChannel(p, q, h + 1 / 3) * 255,
    hueToChannel(p, q, h) * 255,
    hueToChannel(p, q, h - 1 / 3) * 255,
  ]);
};

// Сдвигает светлоту шагами, пока цвет не станет читаться на фоне. Число шагов
// ограничено: сто шагов по 0.01 проходят всю шкалу, дальше идти некуда.
// Контраст меряется у округлённого цвета — того, что реально уйдёт в CSS.
const shiftUntilReadable = (hex, background, direction) => {
  if (contrast(hex, background) >= TEXT_MIN_CONTRAST) return hex;

  const [h, s, start] = toHsl(hex);
  let candidate = hex;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const l = Math.min(1, Math.max(0, start + direction * LIGHTNESS_STEP * step));
    candidate = fromHsl([h, s, l]);
    if (contrast(candidate, background) >= TEXT_MIN_CONTRAST) return candidate;
    if (l === 0 || l === 1) break;
  }
  return candidate;
};

/**
 * Токены из цвета акцента. Всегда отдаёт четыре цвета #rrggbb в нижнем
 * регистре; значение не вида #rrggbb заменяется цветом по умолчанию.
 */
const accentTokens = (accentHex) => {
  const primary = (isHexColor(accentHex) ? accentHex : DEFAULT_ACCENT).toLowerCase();
  return {
    primary,
    primaryForeground:
      contrast(primary, ON_ACCENT_LIGHT) < ON_ACCENT_MIN_CONTRAST ? ON_ACCENT_DARK : ON_ACCENT_LIGHT,
    accentTextLight: shiftUntilReadable(primary, LIGHT_BACKGROUND, -1),
    accentTextDark: shiftUntilReadable(primary, DARK_BACKGROUND, 1),
  };
};

module.exports = { DEFAULT_ACCENT, contrast, accentTokens, isHexColor };

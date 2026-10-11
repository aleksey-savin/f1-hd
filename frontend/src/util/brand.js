/**
 * Бренд инсталляции на клиенте: название портала, значок и цвет акцента.
 *
 * Приходит с сервера уже сведённым (`brand` в `/api/preferences-auth`,
 * `/api/preferences-initial` и `/api/me`). Здесь — чистые функции (заголовок
 * вкладки, CSS акцента, предупреждения) и тонкие обёртки над DOM и
 * localStorage. Чистые покрыты `brand.test.js`; обёртки в тесты не входят.
 */

import {
  DEFAULT_ACCENT,
  accentTokens,
  contrast,
  isHexColor,
  toHsl,
  toRgb,
} from "./brand-color.js";

export const DEFAULT_PRODUCT_NAME = "HelpDesk";

export const DEFAULT_BRAND = Object.freeze({
  productName: DEFAULT_PRODUCT_NAME,
  mailSignature: "",
  accent: DEFAULT_ACCENT,
  icon: "",
});

// Текст цвета акцента в таблице стилей при цвете по умолчанию (--accent-text
// светлой темы). Печатная выгрузка красит им надзаголовок.
const DEFAULT_PRINT_ACCENT = "#007a5e";

// Прозрачность «нашего» пузыря переписки — как у --bubble-out в tailwind.css
const BUBBLE_ALPHA_LIGHT = 0.13;
const BUBBLE_ALPHA_DARK = 0.17;

// Ниже этого контраста белый текст на акценте не читается — см. brand-color.js
const ON_ACCENT_MIN_CONTRAST = 2.2;

// Красный цвет ошибок: насыщенный тон у нуля градусов
const ERROR_MIN_SATURATION = 0.5;
const ERROR_HUE_UP_TO = 12;
const ERROR_HUE_FROM = 345;

const STYLE_ID = "brand-accent";
const CACHE_KEY = "brand";

/** Бренд в полном виде: чего нет или что не того вида — по умолчанию. */
export const normalizeBrand = (raw) => {
  const brand = raw && typeof raw === "object" ? raw : {};
  const productName =
    typeof brand.productName === "string" ? brand.productName.trim() : "";

  return {
    productName: productName || DEFAULT_PRODUCT_NAME,
    mailSignature:
      typeof brand.mailSignature === "string" ? brand.mailSignature : "",
    accent: isHexColor(brand.accent) ? brand.accent.toLowerCase() : DEFAULT_ACCENT,
    icon: typeof brand.icon === "string" ? brand.icon : "",
  };
};

/**
 * Бренд из нового ответа сервера поверх уже известного. Экранам до входа
 * подпись писем не отдаётся (`preferences-auth`): ответ без неё подпись,
 * пришедшую раньше из `/api/me`, не стирает.
 */
export const mergeBrand = (current, raw) => {
  const brand = normalizeBrand(raw);
  return typeof raw?.mailSignature === "string"
    ? brand
    : { ...brand, mailSignature: current?.mailSignature || "" };
};

/** Заголовок вкладки: «Заявки · HelpDesk»; без страницы — одно название. */
export const pageTitle = (page, productName) => {
  const name = String(productName ?? "").trim() || DEFAULT_PRODUCT_NAME;
  const title = String(page ?? "").trim();
  return title && title !== name ? `${title} · ${name}` : name;
};

/**
 * Что сказать под полем цвета: текст на кнопках станет тёмным; цвет близок к
 * цвету ошибок. Ни то ни другое цвет не запрещает.
 */
export const accentWarnings = (accentHex) => {
  if (!isHexColor(accentHex)) return { darkText: false, nearError: false };

  const [hue, saturation] = toHsl(accentHex);
  const degrees = hue * 360;
  return {
    darkText: contrast(accentHex, "#ffffff") < ON_ACCENT_MIN_CONTRAST,
    nearError:
      saturation > ERROR_MIN_SATURATION &&
      (degrees <= ERROR_HUE_UP_TO || degrees >= ERROR_HUE_FROM),
  };
};

const translucent = (hex, alpha) => `rgba(${toRgb(hex).join(", ")}, ${alpha})`;

const declarations = (tokens, accentText, bubbleAlpha) =>
  [
    `--primary:${tokens.primary}`,
    `--primary-foreground:${tokens.primaryForeground}`,
    `--ring:${tokens.primary}`,
    `--accent-text:${accentText}`,
    `--bubble-out:${translucent(tokens.primary, bubbleAlpha)}`,
  ].join(";");

/**
 * CSS, который переопределяет токены акцента в обеих темах. Для цвета по
 * умолчанию — пустая строка: источником остаётся tailwind.css, и инсталляция
 * без своего цвета выглядит ровно как раньше.
 *
 * Селекторы удвоены намеренно. Токены в tailwind.css объявлены вне слоёв
 * (`:root` и `.dark`, специфичность 0,1,0), и одинаковый селектор побеждал бы
 * только порядком в документе — а порядок зависит от того, когда подгрузится
 * таблица стилей. `:root:root` и `:root.dark` (0,2,0) выигрывают при любом
 * порядке; тёмный блок идёт вторым и перекрывает светлый.
 */
export const accentCss = (accentHex) => {
  if (!isHexColor(accentHex)) return "";

  const tokens = accentTokens(accentHex);
  if (tokens.primary === DEFAULT_ACCENT) return "";

  return (
    `:root:root{${declarations(tokens, tokens.accentTextLight, BUBBLE_ALPHA_LIGHT)}}` +
    `:root.dark,:root .dark{${declarations(tokens, tokens.accentTextDark, BUBBLE_ALPHA_DARK)}}`
  );
};

/** Цвет акцента на белой бумаге (печатная выгрузка отчёта). */
export const printAccent = (accentHex) => {
  if (!isHexColor(accentHex)) return DEFAULT_PRINT_ACCENT;

  const tokens = accentTokens(accentHex);
  return tokens.primary === DEFAULT_ACCENT
    ? DEFAULT_PRINT_ACCENT
    : tokens.accentTextLight;
};

/**
 * Адрес значка инсталляции. Имя файла в запросе нужно только затем, чтобы
 * заменённый значок показался сразу, а не после истечения кэша.
 */
export const brandIconUrl = (apiAddress, icon) =>
  `${apiAddress || ""}/api/brand/icon${icon ? `?v=${encodeURIComponent(icon)}` : ""}`;

// ───────────────────────────── обёртки над DOM ─────────────────────────────

/**
 * Красит интерфейс в цвет акцента: один `<style id="brand-accent">` на обе
 * темы, поэтому при смене темы повторный вызов не нужен. Цвет по умолчанию
 * убирает элемент.
 */
export const applyAccent = (accentHex, root = document.documentElement) => {
  const doc = root.ownerDocument;
  const css = accentCss(accentHex);
  const existing = doc.getElementById(STYLE_ID);

  if (!css) {
    existing?.remove();
    return;
  }
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css;
    return;
  }

  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  doc.head.appendChild(style);
};

/**
 * Значок вкладки и ярлыка: ссылки в index.html ведут на `/api/brand/icon`;
 * здесь к ним добавляется имя файла, чтобы заменённый значок не ждал кэша.
 */
export const applyIcon = (icon, doc = document) => {
  const href = brandIconUrl(import.meta.env?.VITE_API_ADDRESS, icon);
  doc
    .querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach((link) => {
      if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    });
};

/**
 * Бренд с прошлой загрузки. Нужен до ответа сервера: без него страница на
 * мгновение показала бы цвет и название по умолчанию. Хранилище может быть
 * недоступно (приватный режим, запрет в настройках) — тогда по умолчанию.
 */
export const readCachedBrand = () => {
  try {
    return normalizeBrand(JSON.parse(localStorage.getItem(CACHE_KEY) || "null"));
  } catch {
    return { ...DEFAULT_BRAND };
  }
};

export const cacheBrand = (brand) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(normalizeBrand(brand)));
  } catch {
    // без кэша следующая загрузка просто начнётся с цвета по умолчанию
  }
};

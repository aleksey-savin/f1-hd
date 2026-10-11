/**
 * Бренд инсталляции: название портала, подпись в письмах, цвет акцента, значок
 * (`Preferences.brand`).
 *
 * В базе пустая строка значит «по умолчанию»; наружу бренд всегда уходит уже
 * сведённым с умолчаниями — через `resolveBrand`, чтобы ни экран, ни письмо не
 * получили `undefined` на документе, созданном до появления этих настроек.
 *
 * Название ПОРТАЛА (`brand.productName`) не путать с названием ОРГАНИЗАЦИИ
 * (`contacts.title`): первое — имя продукта во вкладке и письмах о доступе,
 * второе — кто оказывает услуги.
 */
const { DEFAULT_ACCENT, isHexColor } = require("./brandColor");

const DEFAULT_BRAND = Object.freeze({
  productName: "HelpDesk",
  mailSignature: "",
  accent: DEFAULT_ACCENT,
  icon: "",
});

const PRODUCT_NAME_MAX = 40;
const MAIL_SIGNATURE_MAX = 300;

const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Бренд со всеми умолчаниями. Принимает документ настроек, его lean-копию,
 * `null` и `undefined`; чужие типы и испорченный цвет заменяет умолчаниями.
 */
const resolveBrand = (preferences) => {
  const brand = preferences?.brand || {};
  return {
    productName: text(brand.productName) || DEFAULT_BRAND.productName,
    mailSignature: text(brand.mailSignature),
    accent: isHexColor(brand.accent) ? brand.accent.toLowerCase() : DEFAULT_BRAND.accent,
    icon: text(brand.icon),
  };
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Проверка группы `brand` из формы настроек (сама группа, не всё тело запроса).
 * Отдаёт `{ value }` с тремя полями для записи или `{ error }` с текстом для
 * человека. Пустое значение допустимо и значит «по умолчанию». Значка здесь
 * нет: им управляют отдельные ручки, как лого.
 */
const validateBrandInput = (body) => {
  if (!isPlainObject(body)) return { error: "Настройки бренда переданы в неверном виде" };

  for (const field of ["productName", "mailSignature", "accent"]) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return { error: "Настройки бренда переданы в неверном виде" };
    }
  }

  const productName = text(body.productName);
  if (productName.length > PRODUCT_NAME_MAX) {
    return { error: `Название портала длиннее ${PRODUCT_NAME_MAX} символов` };
  }

  const mailSignature = text(body.mailSignature).replace(/\r\n?/g, "\n");
  if (mailSignature.length > MAIL_SIGNATURE_MAX) {
    return { error: `Подпись в письмах длиннее ${MAIL_SIGNATURE_MAX} символов` };
  }

  const accent = text(body.accent);
  if (accent && !isHexColor(accent)) {
    return { error: "Цвет акцента записывается как #rrggbb" };
  }

  return { value: { productName, mailSignature, accent: accent.toLowerCase() } };
};

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

const escapeHtml = (value) =>
  value === null || value === undefined
    ? ""
    : String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/**
 * Подпись для HTML-письма: своя из настроек, иначе «С уважением» и название
 * организации, иначе пустая строка (письмо без подписи). Текст экранируется —
 * подпись пишет человек, и разметкой она быть не должна.
 */
const mailSignatureHtml = (preferences) => {
  let signature = resolveBrand(preferences).mailSignature;
  if (!signature) {
    const organisation = text(preferences?.contacts?.title);
    if (!organisation) return "";
    signature = `С уважением,\n${organisation}`;
  }
  return `<p>${signature.split(/\r\n?|\n/).map(escapeHtml).join("<br />")}</p>`;
};

module.exports = {
  DEFAULT_BRAND,
  PRODUCT_NAME_MAX,
  MAIL_SIGNATURE_MAX,
  resolveBrand,
  validateBrandInput,
  mailSignatureHtml,
  escapeHtml,
};

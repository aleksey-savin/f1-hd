// node --test services/mail/approvalEmailTemplate.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { accentTokens, DEFAULT_ACCENT } = require("@/services/brandColor");
const { renderApprovalEmail } = require("./approvalEmailTemplate");

const letter = {
  greeting: "Анна",
  role: "согласующего со стороны компании",
  company: "Ромашка",
  contractor: "Север",
  servicePlan: "Абонентское обслуживание",
  period: "май 2026",
  facts: [
    ["Период", "май 2026"],
    ["Сумма к оплате", "10 000 ₽", { strong: true }],
  ],
  link: "https://help.example.com/approval/token",
  deadline: "5 июня",
};

test("цвет по умолчанию: письмо то же, что без цвета вовсе", () => {
  const plain = renderApprovalEmail(letter);
  assert.equal(renderApprovalEmail({ ...letter, accent: DEFAULT_ACCENT }), plain);
  assert.equal(renderApprovalEmail({ ...letter, accent: "#00BC8C" }), plain);
  // испорченное значение — тоже умолчание, а не «undefined» в стилях
  assert.equal(renderApprovalEmail({ ...letter, accent: "синий" }), plain);
  assert.equal(renderApprovalEmail({ ...letter, accent: null }), plain);

  // кант и кнопка — бирюза, текст на кнопке белый
  assert.equal(plain.split(`background:${DEFAULT_ACCENT}`).length - 1, 2);
  assert.match(plain, /color:#ffffff;text-decoration:none/);
  assert.doesNotMatch(plain, /undefined/);
});

test("свой цвет: кант и кнопка перекрашены, бирюзы в письме нет", () => {
  const html = renderApprovalEmail({ ...letter, accent: "#2F7FD6" });
  assert.equal(html.split("background:#2f7fd6").length - 1, 2);
  assert.ok(!html.includes(DEFAULT_ACCENT));
  assert.ok(!html.includes("#007a5e"));
  assert.match(html, /color:#ffffff;text-decoration:none/);
});

test("свой цвет меняет только цвета", () => {
  const plain = renderApprovalEmail(letter);
  const html = renderApprovalEmail({ ...letter, accent: "#2f7fd6" });
  assert.equal(html.replaceAll("#2f7fd6", DEFAULT_ACCENT), plain);
});

test("светлый акцент: текст на кнопке тёмный, иначе его не прочесть", () => {
  const { primaryForeground } = accentTokens("#ffff00");
  assert.equal(primaryForeground, "#1d2227");
  const html = renderApprovalEmail({ ...letter, accent: "#ffff00" });
  assert.match(html, /background:#ffff00/);
  assert.match(html, /color:#1d2227;text-decoration:none/);
});

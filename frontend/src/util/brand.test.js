// node --test src/util/brand.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BRAND,
  accentCss,
  accentWarnings,
  brandIconUrl,
  mergeBrand,
  normalizeBrand,
  pageTitle,
  printAccent,
} from "./brand.js";

test("заголовок вкладки — «страница · портал»", () => {
  assert.equal(pageTitle("Заявки", "Север"), "Заявки · Север");
  assert.equal(pageTitle("", "Север"), "Север");
  assert.equal(pageTitle(undefined, "Север"), "Север");
  assert.equal(pageTitle("  ", "Север"), "Север");
  assert.equal(pageTitle("Заявки", ""), "Заявки · HelpDesk");
  // страница, названная как портал, не двоится
  assert.equal(pageTitle("Север", "Север"), "Север");
});

test("предупреждения о цвете акцента", () => {
  assert.equal(accentWarnings("#ffff00").darkText, true);
  assert.equal(accentWarnings("#d63c3c").nearError, true);
  assert.deepEqual(accentWarnings("#00bc8c"), { darkText: false, nearError: false });
  assert.deepEqual(accentWarnings("#2f7fd6"), { darkText: false, nearError: false });
  // серый: тон нулевой, но насыщенности нет — на ошибку не похож
  assert.equal(accentWarnings("#808080").nearError, false);
  // малиновый у границы красного
  assert.equal(accentWarnings("#e0204a").nearError, true);
});

test("цвет по умолчанию не даёт своих правил — работает таблица стилей", () => {
  assert.equal(accentCss("#00bc8c"), "");
  assert.equal(accentCss("#00BC8C"), "");
  assert.equal(accentCss("не цвет"), "");
  assert.equal(accentCss(undefined), "");
});

test("свой цвет переопределяет токены обеих тем", () => {
  const css = accentCss("#2f7fd6");
  const [light, dark] = css.split("}").map((part) => part.trim());

  assert.match(light, /^:root:root\{/);
  assert.match(dark, /^:root\.dark,:root \.dark\{/);
  for (const block of [light, dark]) {
    assert.ok(block.includes("--primary:#2f7fd6"));
    assert.ok(block.includes("--ring:#2f7fd6"));
    assert.ok(block.includes("--primary-foreground:#ffffff"));
  }
  assert.ok(light.includes("--accent-text:#2877cd"));
  assert.ok(dark.includes("--accent-text:#4089d9"));
  assert.ok(light.includes("--bubble-out:rgba(47, 127, 214, 0.13)"));
  assert.ok(dark.includes("--bubble-out:rgba(47, 127, 214, 0.17)"));
});

test("светлый акцент получает тёмный текст на кнопке", () => {
  assert.ok(accentCss("#ffff00").includes("--primary-foreground:#1d2227"));
});

test("бренд без данных сводится к значениям по умолчанию", () => {
  assert.deepEqual(normalizeBrand(null), DEFAULT_BRAND);
  assert.deepEqual(normalizeBrand({}), DEFAULT_BRAND);
  assert.deepEqual(normalizeBrand("строка"), DEFAULT_BRAND);
  assert.deepEqual(
    normalizeBrand({ productName: "  ", accent: "red", icon: 5, mailSignature: null }),
    DEFAULT_BRAND,
  );
  assert.deepEqual(
    normalizeBrand({ productName: " Север ", accent: "#2F7FD6", icon: "i.png", mailSignature: "С уважением" }),
    { productName: "Север", accent: "#2f7fd6", icon: "i.png", mailSignature: "С уважением" },
  );
});

test("бренд с экрана входа приходит без подписи писем и уже известную не стирает", () => {
  const known = { productName: "Север", accent: "#2f7fd6", icon: "", mailSignature: "С уважением" };
  // Ответ `preferences-auth`: три поля
  assert.deepEqual(mergeBrand(known, { productName: "Юг", accent: "#D62F2F", icon: "i.png" }), {
    productName: "Юг",
    accent: "#d62f2f",
    icon: "i.png",
    mailSignature: "С уважением",
  });
  // Ответ с подписью (`/api/me`, сохранение настроек) её заменяет, в том числе пустой
  assert.equal(mergeBrand(known, { ...known, mailSignature: "" }).mailSignature, "");
  assert.equal(mergeBrand(known, { ...known, mailSignature: "Команда" }).mailSignature, "Команда");
  // Ничего не известно и ничего не пришло — значения по умолчанию
  assert.deepEqual(mergeBrand(undefined, null), DEFAULT_BRAND);
  assert.deepEqual(mergeBrand(DEFAULT_BRAND, { productName: "Юг" }), { ...DEFAULT_BRAND, productName: "Юг" });
});

test("адрес значка меняется вместе с файлом", () => {
  assert.equal(brandIconUrl("", ""), "/api/brand/icon");
  assert.equal(brandIconUrl("", "icon-17.png"), "/api/brand/icon?v=icon-17.png");
  assert.equal(
    brandIconUrl("https://hd.example", "a b.png"),
    "https://hd.example/api/brand/icon?v=a%20b.png",
  );
  assert.equal(brandIconUrl(undefined, ""), "/api/brand/icon");
});

test("цвет акцента в печатной выгрузке", () => {
  // по умолчанию — тот же оттенок, что был зашит в выгрузку
  assert.equal(printAccent("#00bc8c"), "#007a5e");
  assert.equal(printAccent(undefined), "#007a5e");
  assert.equal(printAccent("#2f7fd6"), "#2877cd");
  assert.equal(printAccent("#ffff00"), "#7a7a00");
});

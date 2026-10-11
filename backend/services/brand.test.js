// node --test services/brand.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_BRAND,
  resolveBrand,
  validateBrandInput,
  mailSignatureHtml,
  escapeHtml,
} = require("./brand");

test("DEFAULT_BRAND — умолчания продукта", () => {
  assert.deepEqual(DEFAULT_BRAND, {
    productName: "HelpDesk",
    mailSignature: "",
    accent: "#00bc8c",
    icon: "",
  });
});

test("resolveBrand: без настроек и с пустым брендом — умолчания", () => {
  for (const input of [null, undefined, {}, { brand: null }, { brand: {} }, { brand: { productName: "  " } }]) {
    assert.deepEqual(resolveBrand(input), DEFAULT_BRAND);
  }
  // умолчания не отдаются по ссылке: правка ответа их не портит
  resolveBrand(null).productName = "x";
  assert.equal(DEFAULT_BRAND.productName, "HelpDesk");
});

test("resolveBrand: заданные значения проходят как есть", () => {
  const brand = {
    productName: "Портал Ромашки",
    mailSignature: "С уважением,\nКоманда",
    accent: "#2F7FD6",
    icon: "abc.png",
  };
  assert.deepEqual(resolveBrand({ brand }), { ...brand, accent: "#2f7fd6" });
});

test("resolveBrand: испорченный цвет и чужие типы не уходят наружу", () => {
  const resolved = resolveBrand({ brand: { productName: 42, mailSignature: null, accent: "red", icon: {} } });
  assert.deepEqual(resolved, DEFAULT_BRAND);
});

test("resolveBrand: принимает документ Mongoose", () => {
  const doc = { brand: { toObject: () => ({ productName: "Имя" }), productName: "Имя" } };
  assert.equal(resolveBrand(doc).productName, "Имя");
});

test("validateBrandInput: пустое тело — пустые значения (то есть умолчания)", () => {
  assert.deepEqual(validateBrandInput({}), {
    value: { productName: "", mailSignature: "", accent: "" },
  });
});

test("validateBrandInput: пробелы обрезаются, цвет приводится к нижнему регистру", () => {
  assert.deepEqual(
    validateBrandInput({ productName: "  Портал  ", mailSignature: " Подпись\r\nстрока ", accent: " #2F7FD6 " }),
    { value: { productName: "Портал", mailSignature: "Подпись\nстрока", accent: "#2f7fd6" } },
  );
  assert.deepEqual(validateBrandInput({ productName: "   " }).value.productName, "");
});

test("validateBrandInput: границы длины", () => {
  assert.ok(validateBrandInput({ productName: "я".repeat(40) }).value);
  assert.match(validateBrandInput({ productName: "я".repeat(41) }).error, /40/);
  assert.ok(validateBrandInput({ mailSignature: "я".repeat(300) }).value);
  assert.match(validateBrandInput({ mailSignature: "я".repeat(301) }).error, /300/);
});

test("validateBrandInput: цвет только #rrggbb", () => {
  for (const accent of ["red", "#fff", "00bc8c", "#00bc8g"]) {
    const result = validateBrandInput({ accent });
    assert.match(result.error, /#rrggbb/);
    assert.equal(result.value, undefined);
  }
});

test("validateBrandInput: не объект и не строки — отказ, значок из тела не берётся", () => {
  for (const body of [null, undefined, "x", [], 5]) assert.ok(validateBrandInput(body).error);
  assert.ok(validateBrandInput({ productName: { $ne: "" } }).error);
  assert.ok(validateBrandInput({ mailSignature: 5 }).error);
  assert.ok(validateBrandInput({ accent: ["#00bc8c"] }).error);
  assert.equal("icon" in validateBrandInput({ icon: "../../etc/passwd" }).value, false);
});

test("mailSignatureHtml: своя подпись, переводы строк — <br />", () => {
  assert.equal(
    mailSignatureHtml({ brand: { mailSignature: "С уважением,\nКоманда" } }),
    "<p>С уважением,<br />Команда</p>",
  );
});

test("mailSignatureHtml: без подписи — «С уважением» и название организации", () => {
  assert.equal(
    mailSignatureHtml({ contacts: { title: "ООО «Ромашка»" } }),
    "<p>С уважением,<br />ООО «Ромашка»</p>",
  );
});

test("mailSignatureHtml: нет ни подписи, ни организации — пусто", () => {
  for (const input of [null, undefined, {}, { brand: { mailSignature: "  " }, contacts: { title: " " } }]) {
    assert.equal(mailSignatureHtml(input), "");
  }
});

test("mailSignatureHtml: разметка экранируется — и в подписи, и в названии", () => {
  const own = mailSignatureHtml({ brand: { mailSignature: "<script>x</script>" } });
  assert.ok(own.includes("&lt;script&gt;"));
  assert.equal(own.includes("<script"), false);

  const fallback = mailSignatureHtml({ contacts: { title: '<img src=x onerror="a">' } });
  assert.equal(fallback.includes("<img"), false);
  assert.ok(fallback.includes("&lt;img"));
});

test("escapeHtml: пять знаков, не строки приводятся", () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(5), "5");
});

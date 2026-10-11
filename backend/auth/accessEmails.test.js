// node --test auth/accessEmails.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const accessEmails = require("./accessEmails");

const user = { firstName: "Анна" };
const url = "https://help.example.com/reset-password/token";
const details = { user, url, otp: "123456", minutes: 10 };

const all = (preferences) =>
  Object.fromEntries(
    Object.entries(accessEmails).map(([kind, build]) => [
      kind,
      build({ preferences, ...details }),
    ]),
  );

test("без настроек: в темах название портала по умолчанию", () => {
  for (const preferences of [null, undefined, {}, { brand: {} }]) {
    const letters = all(preferences);
    assert.deepEqual(
      Object.fromEntries(Object.entries(letters).map(([kind, { title }]) => [kind, title])),
      {
        passwordInvitation: "Вам открыт доступ в портал HelpDesk",
        passwordReset: "Восстановление доступа к порталу HelpDesk",
        linkInvitation: "Вам открыт доступ в портал HelpDesk",
        signInLink: "Вход в портал HelpDesk",
        signInCode: "Код для входа в портал HelpDesk",
        passwordCode: "Код для смены пароля в портале HelpDesk",
      },
    );
  }
});

test("своё название портала — во всех темах", () => {
  const letters = all({ brand: { productName: "Север" } });
  for (const { title } of Object.values(letters)) {
    assert.ok(title.endsWith(" Север"), title);
    assert.ok(!title.includes("HelpDesk"), title);
  }
});

test("приглашения называют организацию, а не портал", () => {
  const letters = all({
    brand: { productName: "Север" },
    contacts: { title: "Ромашка" },
  });
  for (const kind of ["passwordInvitation", "linkInvitation"]) {
    assert.match(
      letters[kind].body,
      /учётная запись в портале поддержки Ромашка — через него/,
    );
    assert.ok(!letters[kind].body.includes("Север"));
  }
});

test("организация не задана: фраза без названия и без лишнего пробела", () => {
  for (const contacts of [undefined, {}, { title: "" }, { title: "   " }, { title: 42 }]) {
    const letters = all({ contacts });
    for (const kind of ["passwordInvitation", "linkInvitation"]) {
      assert.match(
        letters[kind].body,
        /учётная запись в портале поддержки — через него/,
      );
    }
  }
});

test("разметка в названиях: в теле экранируется, тема остаётся текстом", () => {
  const letters = all({
    brand: { productName: "<b>Север</b> & Ко" },
    contacts: { title: '<script>alert("x")</script>' },
  });
  for (const { body } of Object.values(letters)) {
    assert.ok(!body.includes("<script>"));
  }
  assert.ok(
    letters.passwordInvitation.body.includes(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    ),
  );
  // тема — не HTML: сущностей в ней быть не должно
  assert.equal(
    letters.signInLink.title,
    "Вход в портал <b>Север</b> & Ко",
  );
});

test("перевод строки в названии портала не попадает в тему", () => {
  const letters = all({ brand: { productName: "Север\r\nBcc: x@example.com" } });
  for (const { title } of Object.values(letters)) {
    assert.doesNotMatch(title, /[\r\n]/);
  }
  assert.equal(letters.signInLink.title, "Вход в портал Север Bcc: x@example.com");
});

test("старого названия нет ни в одном письме", () => {
  for (const preferences of [null, { brand: { productName: "Север" }, contacts: { title: "Ромашка" } }]) {
    for (const { title, body } of Object.values(all(preferences))) {
      assert.doesNotMatch(title + body, /F1\s?Lab/i);
    }
  }
});

test("обращение: имя, иначе «Здравствуйте»; код и ссылка на месте", () => {
  const preferences = null;
  assert.match(accessEmails.signInLink({ preferences, user, url }).body, /<p>Анна,<\/p>/);
  assert.match(accessEmails.signInLink({ preferences, user: null, url }).body, /<p>Здравствуйте,<\/p>/);
  assert.ok(accessEmails.passwordReset({ preferences, user, url }).body.includes(`href="${url}"`));
  const code = accessEmails.signInCode({ preferences, ...details }).body;
  assert.match(code, />123456<\/p>/);
  assert.match(code, /действителен 10 минут/);
});

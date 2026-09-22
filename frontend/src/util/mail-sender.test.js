// node --test src/util/mail-sender.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMailSender, formatMailSender } from "./mail-sender.js";

test("имя в кавычках и адрес в угловых скобках", () => {
  assert.deepEqual(parseMailSender('"Иван Петров" <ivan@corp.ru>'), {
    name: "Иван Петров",
    address: "ivan@corp.ru",
  });
});

test("имя без кавычек", () => {
  assert.deepEqual(parseMailSender("Иван Петров <ivan@corp.ru>"), {
    name: "Иван Петров",
    address: "ivan@corp.ru",
  });
});

test("голый адрес — имени нет", () => {
  assert.deepEqual(parseMailSender("ivan@corp.ru"), {
    name: null,
    address: "ivan@corp.ru",
  });
});

test("имя, совпадающее с адресом, не дублируется", () => {
  assert.deepEqual(parseMailSender("ivan@corp.ru <ivan@corp.ru>"), {
    name: null,
    address: "ivan@corp.ru",
  });
});

test("адрес приводится к нижнему регистру, имя — нет", () => {
  assert.deepEqual(parseMailSender("Ivan <Ivan.Petrov@Corp.RU>"), {
    name: "Ivan",
    address: "ivan.petrov@corp.ru",
  });
});

test("пустое и мусор дают null", () => {
  assert.equal(parseMailSender(""), null);
  assert.equal(parseMailSender(undefined), null);
  assert.equal(parseMailSender("без адреса вовсе"), null);
});

test("строка для интерфейса: «Имя <адрес>» или адрес", () => {
  assert.equal(
    formatMailSender('"Иван Петров" <ivan@corp.ru>'),
    "Иван Петров <ivan@corp.ru>",
  );
  assert.equal(formatMailSender("ivan@corp.ru"), "ivan@corp.ru");
  assert.equal(formatMailSender(""), null);
});

// node --test services/help/frontMatter.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseFrontMatter } = require("./frontMatter");

test("шапка и тело разделяются, значения обрезаются", () => {
  const parsed = parseFrontMatter(
    "---\ntitle: Как подать заявку\nsummary:  Два шага \n---\n\n## Шаги\nТекст",
  );
  assert.deepEqual(parsed.meta, {
    title: "Как подать заявку",
    summary: "Два шага",
  });
  assert.equal(parsed.body, "## Шаги\nТекст");
});

test("двоеточие в значении и кавычки вокруг него", () => {
  const { meta } = parseFrontMatter(
    '---\ntitle: "Вход: по коду"\nlink: /my-account#security\n---\nТело',
  );
  assert.equal(meta.title, "Вход: по коду");
  assert.equal(meta.link, "/my-account#security");
});

test("CRLF и BOM не мешают", () => {
  const { meta, body } = parseFrontMatter(
    "﻿---\r\ntitle: А\r\nsummary: Б\r\n---\r\nТело",
  );
  assert.equal(meta.title, "А");
  assert.equal(body, "Тело");
});

test("нет шапки или она не закрыта — null", () => {
  assert.equal(parseFrontMatter("## Просто текст"), null);
  assert.equal(parseFrontMatter("---\ntitle: А\nТело без закрытия"), null);
  assert.equal(parseFrontMatter(""), null);
});

test("строки без двоеточия и комментарии пропускаются", () => {
  const { meta } = parseFrontMatter("---\n# заметка\nмусор\ntitle: А\n---\n");
  assert.deepEqual(meta, { title: "А" });
});

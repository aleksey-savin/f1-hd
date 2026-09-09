// node --test helpers/htmlToPlainText.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { htmlToPlainText, htmlToPlainLines } = require("./htmlToPlainText");

test("htmlToPlainText: одна строка для поиска — переводы строк не нужны", () => {
  assert.equal(
    htmlToPlainText("<p>Первый</p><p>Второй</p>"),
    "Первый Второй",
  );
});

test("htmlToPlainLines: абзацы и <br> становятся переводами строк", () => {
  assert.equal(
    htmlToPlainLines("<p>Первый</p><p>Второй</p>"),
    "Первый\nВторой",
  );
  assert.equal(htmlToPlainLines("А<br>Б<br/>В"), "А\nБ\nВ");
});

test("htmlToPlainLines: собранное из ответов описание — строка на вопрос", () => {
  assert.equal(
    htmlToPlainLines(
      "<p><strong>ФИО:</strong> Петрова Анна</p><p><strong>Пропуск:</strong> Да</p>",
    ),
    "ФИО: Петрова Анна\nПропуск: Да",
  );
});

test("htmlToPlainLines: пустой документ редактора — пустая строка", () => {
  assert.equal(htmlToPlainLines("<p><br></p>"), "");
  assert.equal(htmlToPlainLines(""), "");
  assert.equal(htmlToPlainLines(null), "");
});

test("htmlToPlainLines: entity раскрываются, амперсанд не ломает теги", () => {
  assert.equal(
    htmlToPlainLines("<p>Сервер &laquo;1С&raquo; &amp; касса &lt;тест&gt;</p>"),
    "Сервер «1С» & касса <тест>",
  );
  assert.equal(htmlToPlainLines("<p>А&nbsp;Б</p>"), "А Б");
});

test("htmlToPlainLines: пустые абзацы не оставляют дыр", () => {
  assert.equal(htmlToPlainLines("<p>А</p><p></p><p>Б</p>"), "А\nБ");
});

test("htmlToPlainLines: длинный текст режется по границе слова", () => {
  const clipped = htmlToPlainLines(`<p>${"слово ".repeat(300)}</p>`, 50);
  assert.ok(clipped.length <= 50, `длина ${clipped.length}`);
  assert.ok(clipped.endsWith("…"));
  assert.ok(!/\sсло…$/.test(clipped), "обрыв посреди слова");
});

test("htmlToPlainLines: короткий текст не трогается", () => {
  assert.equal(htmlToPlainLines("<p>Не работает почта</p>", 50), "Не работает почта");
});

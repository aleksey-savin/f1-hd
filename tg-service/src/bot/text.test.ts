// node --test src/bot/text.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { plainText } from "./text.ts";

test("абзацы и переводы строк становятся переводами строк", () => {
  assert.equal(
    plainText("<p>Первый</p><p>Второй</p>"),
    "Первый\nВторой",
  );
  assert.equal(plainText("Строка<br>Вторая<br/>Третья"), "Строка\nВторая\nТретья");
});

test("собранное из ответов описание читается строкой на вопрос", () => {
  assert.equal(
    plainText(
      "<p><strong>ФИО:</strong> Петрова Анна</p><p><strong>Пропуск:</strong> Да</p>",
    ),
    "ФИО: Петрова Анна\nПропуск: Да",
  );
});

test("теги снимаются, entity раскрываются", () => {
  assert.equal(
    plainText('<div class="x">Сервер &laquo;1С&raquo; &amp; касса &lt;тест&gt;</div>'),
    "Сервер «1С» & касса <тест>",
  );
  assert.equal(plainText("<p>А&nbsp;Б</p>"), "А Б");
});

test("пустой документ редактора — пустая строка", () => {
  assert.equal(plainText("<p><br></p>"), "");
  assert.equal(plainText(""), "");
  assert.equal(plainText(undefined), "");
  assert.equal(plainText("   \n  "), "");
});

test("списки не склеиваются в одно слово", () => {
  assert.equal(
    plainText("<ul><li>Первый</li><li>Второй</li></ul>"),
    "Первый\nВторой",
  );
});

test("пустые строки подряд сжимаются до одной", () => {
  assert.equal(plainText("<p>А</p><p></p><p></p><p>Б</p>"), "А\nБ");
});

test("длинный текст режется по границе слова с многоточием", () => {
  const long = plainText(`<p>${"слово ".repeat(200)}</p>`, 60);
  assert.ok(long.length <= 60, `длина ${long.length}`);
  assert.ok(long.endsWith("…"));
  assert.ok(!long.endsWith("сло…"), "обрыв посреди слова");
});

test("короткий текст не трогается", () => {
  assert.equal(plainText("<p>Не работает почта</p>", 60), "Не работает почта");
});

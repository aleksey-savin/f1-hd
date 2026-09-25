// node --test services/messaging/origin.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { describeAsHtml } = require("./origin");

test("a non-empty line becomes its own escaped paragraph", () => {
  assert.equal(describeAsHtml(["Иван, 10:30: Кондиционер шумит"]), "<p>Иван, 10:30: Кондиционер шумит</p>");
  assert.equal(
    describeAsHtml(["Клиент: <b>перезвоните</b> & срочно \"нужно\" 'сейчас'"]),
    "<p>Клиент: &lt;b&gt;перезвоните&lt;/b&gt; &amp; срочно &quot;нужно&quot; &#39;сейчас&#39;</p>",
  );
});

test("several lines become several paragraphs, in order", () => {
  assert.equal(
    describeAsHtml(["Первая строка", "Вторая строка"]),
    "<p>Первая строка</p><p>Вторая строка</p>",
  );
});

test("empty and blank lines are dropped, not wrapped", () => {
  assert.equal(describeAsHtml(["Первая строка", "", "   ", "Вторая строка"]), "<p>Первая строка</p><p>Вторая строка</p>");
  assert.equal(describeAsHtml([]), "");
  assert.equal(describeAsHtml(["", "  "]), "");
});

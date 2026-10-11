// node --test src/util/help.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  searchArticles,
  resolveImages,
  railSections,
  articlePath,
  indexPath,
  formatUpdated,
  sectionAnchor,
} from "./help.js";

const SECTIONS = [
  {
    key: "tickets",
    title: "Заявки",
    articles: [
      { slug: "new", title: "Новая заявка", summary: "Форма и шаблоны" },
      { slug: "card", title: "Карточка заявки", summary: "Что где лежит" },
    ],
  },
  {
    key: "reports",
    title: "Отчёты",
    articles: [
      { slug: "my", title: "Мой отчёт", summary: "Часы и ШАБЛОНЫ выгрузки" },
    ],
  },
];

test("поиск по названию и аннотации без учёта регистра", () => {
  assert.deepEqual(
    searchArticles(SECTIONS, "  шаблон ").map((a) => a.slug),
    ["new", "my"],
  );
  assert.equal(searchArticles(SECTIONS, "ОТЧЁТ")[0].section.title, "Отчёты");
  assert.deepEqual(searchArticles(SECTIONS, ""), []);
  assert.deepEqual(searchArticles(SECTIONS, "впн"), []);
});

test("картинки: относительный путь получает адрес маршрута", () => {
  const base = "/api/help/staff/tickets";
  assert.equal(
    resolveImages(
      'Текст ![схема](img/a-1.png) и ![б](img/b.JPG "подпись")',
      base,
    ),
    'Текст ![схема](/api/help/staff/tickets/img/a-1.png) и ![б](/api/help/staff/tickets/img/b.JPG "подпись")',
  );
  const untouched =
    "![x](https://example.com/a.png) [ссылка](img/a.png) ![y](../img/a.png)";
  assert.equal(resolveImages(untouched, base), untouched);
});

test("рейка — от трёх заголовков", () => {
  assert.deepEqual(railSections(["А", "Б"]), []);
  assert.deepEqual(railSections([]), []);
  assert.deepEqual(railSections(["А", "Б", "В"]), [
    { id: "h-1", label: "А" },
    { id: "h-2", label: "Б" },
    { id: "h-3", label: "В" },
  ]);
});

test("адреса", () => {
  assert.equal(
    articlePath("client", "tickets", "new"),
    "/help/client/tickets/new",
  );
  assert.equal(indexPath("staff", false), "/help");
  assert.equal(indexPath("client", false), "/help?for=client");
  assert.equal(indexPath("client", true), "/help");
  assert.equal(
    indexPath("client", false, "tickets"),
    "/help?for=client#help-tickets",
  );
  assert.equal(sectionAnchor("tickets"), "help-tickets");
});

test("дата обновления: год — только когда он не текущий, мусор не роняет", () => {
  const now = new Date("2026-10-11T12:00:00");
  assert.equal(formatUpdated("2026-10-11", now), "11 октября");
  assert.equal(formatUpdated("2025-03-02", now), "2 марта 2025");
  assert.equal(formatUpdated("2026-13-01", now), "");
  assert.equal(formatUpdated(null, now), "");
});

test("картинки: ./img, ссылочный синтаксис, код не трогаем", () => {
  const base = "/api/help/staff/tickets";
  assert.equal(
    resolveImages("![а](./img/a.png)", base),
    `![а](${base}/img/a.png)`,
  );
  assert.equal(
    resolveImages(
      '![схема][s]\n\n[s]: img/s.png\n[t]: ./img/t.webp "Подпись"',
      base,
    ),
    `![схема][s]\n\n[s]: ${base}/img/s.png\n[t]: ${base}/img/t.webp "Подпись"`,
  );
  const code = [
    "Пишите так: `![подпись](img/a.png)`.",
    "",
    "```markdown",
    "![подпись](img/a.png)",
    "[s]: img/s.png",
    "```",
    "",
    "~~~",
    "![x](img/b.png)",
    "~~~",
  ].join("\n");
  assert.equal(resolveImages(code, base), code);
  assert.equal(
    resolveImages("`код` и ![а](img/a.png)", base),
    `\`код\` и ![а](${base}/img/a.png)`,
  );
});

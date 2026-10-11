// node --test services/help/catalogue.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadCatalogue, NAME } = require("./catalogue");

const DEFS = [
  { audience: "client", key: "tickets", title: "Заявки" },
  { audience: "staff", key: "tickets", title: "Заявки" },
  { audience: "staff", key: "works", title: "Работы", modules: ["timeTracking"] },
];

const article = (title, extra = "") =>
  `---\ntitle: ${title}\nsummary: Кратко\n${extra}---\nТекст`;

const tree = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "help-"));
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
};

test("статьи раскладываются по разделам и сортируются", () => {
  const root = tree({
    "staff/tickets/card.md": article("Карточка", "order: 2\n"),
    "staff/tickets/queues.md": article("Очереди", "order: 1\n"),
    "staff/tickets/beta.md": article("Бета"),
    "staff/tickets/alpha.md": article("Альфа"),
    "client/tickets/new.md": article("Как подать заявку"),
  });
  const { sections, warnings } = loadCatalogue(root, DEFS);
  assert.deepEqual(warnings, []);
  const staff = sections.find((s) => s.audience === "staff" && s.key === "tickets");
  assert.deepEqual(
    staff.articles.map((a) => a.slug),
    ["queues", "card", "alpha", "beta"],
  );
  assert.equal(sections.find((s) => s.audience === "client").articles[0].title, "Как подать заявку");
  assert.equal(sections.find((s) => s.key === "works").articles.length, 0);
});

test("необязательные поля: дата, ссылка парой", () => {
  const root = tree({
    "staff/tickets/a.md": article("А", "updated: 2026-10-11\nlink: /tickets\nlinkLabel: Открыть заявки\n"),
    "staff/tickets/b.md": article("Б", "updated: вчера\nlink: /tickets\n"),
    "staff/tickets/c.md": article("В", "link: //evil.example\nlinkLabel: Открыть\n"),
  });
  const [a, b, c] = loadCatalogue(root, DEFS).sections.find(
    (s) => s.audience === "staff" && s.key === "tickets",
  ).articles;
  assert.deepEqual([a.updated, a.link, a.linkLabel], ["2026-10-11", "/tickets", "Открыть заявки"]);
  assert.deepEqual([b.updated, b.link, b.linkLabel], [null, null, null]);
  assert.deepEqual([c.link, c.linkLabel], [null, null]);
});

test("несуществующая дата и пустой order отбрасываются", () => {
  const root = tree({
    "staff/tickets/a.md": article("А", "updated: 2026-13-01\norder:\n"),
    "staff/tickets/b.md": article("Б", "updated: 2026-02-30\norder: 1\n"),
  });
  const articles = loadCatalogue(root, DEFS).sections.find(
    (s) => s.audience === "staff" && s.key === "tickets",
  ).articles;
  // пустой order — «без порядка»: статья идёт после упорядоченной
  assert.deepEqual(articles.map((a) => a.slug), ["b", "a"]);
  assert.deepEqual(articles.map((a) => a.updated), [null, null]);
  assert.equal(articles[1].order, null);
});

test("негодные файлы пропускаются с предупреждением, остальные работают", () => {
  const root = tree({
    "staff/tickets/ok.md": article("Годная"),
    "staff/tickets/Bad Name.md": article("Имя"),
    "staff/tickets/no-title.md": "---\nsummary: Кратко\n---\nТекст",
    "staff/tickets/broken.md": "---\ntitle: А\nТекст без закрытия",
    "staff/unknown/orphan.md": article("Сирота"),
    "staff/tickets/img/shot.png": "x",
    "staff/tickets/notes.txt": "x",
  });
  const { sections, warnings } = loadCatalogue(root, DEFS);
  const articles = sections.find((s) => s.audience === "staff" && s.key === "tickets").articles;
  assert.deepEqual(articles.map((a) => a.slug), ["ok"]);
  assert.equal(warnings.length, 4);
  assert.ok(warnings.some((w) => w.includes("orphan.md")));
});

test("пустой или отсутствующий каталог — разделы без статей", () => {
  const { sections, warnings } = loadCatalogue(path.join(os.tmpdir(), "help-missing-dir"), DEFS);
  assert.equal(sections.length, 3);
  assert.ok(sections.every((s) => s.articles.length === 0));
  assert.deepEqual(warnings, []);
});

test("шаблон имени", () => {
  for (const good of ["a", "new-ticket", "2fa"]) assert.ok(NAME.test(good));
  for (const bad of ["", "..", "a/b", "A", "a_b", "-a", "a-", "%2e%2e", "a.md"]) assert.ok(!NAME.test(bad));
});

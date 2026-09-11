const test = require("node:test");
const assert = require("node:assert/strict");

const { buildFeed, feedForClient } = require("./ticketEvents");

const at = (minute) => `2026-09-08T10:0${minute}:00Z`;

const LOGS = [
  { _id: 1, kind: "created", event: "создана новая заявка", createdAt: at(0) },
  { _id: 2, kind: "ai", event: "начал подбор категории", createdAt: at(1) },
  { _id: 3, kind: "delivery", event: "отправлено email-уведомление", createdAt: at(2) },
  { _id: 4, kind: "updated", event: "заявка обновлена", createdAt: at(3) },
  { _id: 5, kind: "processed", event: "обработана заявка", createdAt: at(4) },
  { _id: 6, kind: "taken", event: "принята в работу", createdAt: at(5) },
  { _id: 7, kind: "helpRequested", event: "запросил(а) помощь", createdAt: at(6) },
  { _id: 8, kind: "workAdded", event: "добавлены работы", createdAt: at(7) },
  { _id: 9, kind: "comment", event: "добавлен комментарий", createdAt: at(8) },
];

test("лента сотрудника: события заявки, служебные — счётчиком", () => {
  const feed = buildFeed(LOGS);

  assert.deepEqual(
    feed.map((event) => event.kind),
    ["created", "updated", "processed", "taken", "helpRequested", "workAdded"],
  );
  // Комментарий показывает сам комментарий, событие о нём скрыто
  assert.ok(!feed.some((event) => event.kind === "comment"));
  // Две служебные записи свернулись под предыдущим событием
  assert.equal(feed[0].technical.count, 2);
});

test("лента заявителя: ход заявки и работы, без внутренней кухни", () => {
  const client = feedForClient(buildFeed(LOGS));

  assert.deepEqual(
    client.map((event) => event.kind),
    ["created", "processed", "taken", "workAdded"],
  );
});

test("заявителю не уезжает счётчик служебных записей", () => {
  const client = feedForClient(buildFeed(LOGS));

  assert.ok(client.every((event) => event.technical === undefined));
});

test("пустая лента переживает отбор", () => {
  assert.deepEqual(feedForClient(), []);
  assert.deepEqual(feedForClient([]), []);
});

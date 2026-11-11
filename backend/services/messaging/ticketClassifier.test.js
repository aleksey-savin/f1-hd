require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const Preferences = require("../../models/preferences");
const aiService = require("../aiService");
const { classifyIncomingTicket } = require("./ticketClassifier");

const ids = ["111111111111111111111111", "222222222222222222222222"];
const companyId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const conversation = {
  _id: "cccccccccccccccccccccccc",
  kind: "direct",
  companyId,
  ticketBindings: ids.map((ticketId) => ({ ticketId })),
};
const linkedTickets = [
  {
    _id: ids[0],
    num: 101,
    title: "Принтер на складе",
    description: "Принтер на складе не печатает документы",
    company: { _id: companyId },
    isClosed: false,
  },
  {
    _id: ids[1],
    num: 102,
    title: "Доступ к почте",
    description: "Не открывается почтовый ящик",
    company: { _id: companyId },
    isClosed: false,
  },
];
const message = {
  direction: "in",
  origin: "client",
  text: "Принтер на складе снова не печатает документы",
  sentAt: new Date("2026-11-11T00:00:00Z"),
  conversationId: conversation._id,
};
const answer = {
  ticketId: ids[0],
  confidence: 0.97,
  ambiguous: false,
  messageQuote: "Принтер на складе",
  ticketQuote: "Принтер на складе",
};
const setup = (
  t,
  output = answer,
  preferences = {
    messaging: { aiTicketRouting: true },
    ai: { isActive: true },
  },
) => {
  const prompts = [];
  t.mock.method(Preferences, "findOne", async () => preferences);
  t.mock.method(aiService, "generateJson", async (prompt) => {
    prompts.push(prompt);
    if (output instanceof Error) throw output;
    return { data: output };
  });
  return prompts;
};
const classify = (extra = {}) =>
  classifyIncomingTicket({ conversation, message, linkedTickets, ...extra });

test("optional routing is off for existing installations and respects the global AI switch", async (t) => {
  const prompts = setup(t, answer, { ai: { isActive: true } });
  assert.equal(await classify(), null);
  assert.equal(prompts.length, 0);
});

test("a grounded confident result assigns only the linked open ticket", async (t) => {
  setup(t);
  assert.deepEqual(await classify(), {
    ticketId: ids[0],
    attachMode: "ai",
    confidence: 0.97,
  });
});

test("malformed, hallucinated, ambiguous and unsupported results remain unresolved", async (t) => {
  for (const output of [
    null,
    [],
    "bad",
    {},
    { ...answer, ticketId: "invented" },
    { ...answer, confidence: 0.89 },
    { ...answer, confidence: "0.99" },
    { ...answer, ambiguous: true },
    { ...answer, ambiguous: undefined },
    { ...answer, messageQuote: "Выдуманное сообщение" },
    { ...answer, ticketQuote: "Выдуманное описание" },
    { ...answer, ticketQuote: "" },
    { ...answer, messageQuote: "Да" },
  ]) {
    await t.test(JSON.stringify(output), async (sub) => {
      setup(sub, output);
      assert.equal(await classify(), null);
    });
  }
});

test("provider errors and an unconfigured provider never fail ingestion or retry", async (t) => {
  const prompts = setup(t, new Error("API key is not set"));
  assert.equal(await classify(), null);
  assert.equal(prompts.length, 1);
});

test("disabled AI, manual mapping, imported and non-client messages do not call a provider", async (t) => {
  const prompts = setup(t, answer, {
    messaging: { aiTicketRouting: true },
    ai: { isActive: false },
  });
  assert.equal(await classify(), null);
  assert.equal(prompts.length, 0);
  t.mock.restoreAll();
  const enabledPrompts = setup(t);
  for (const change of [
    { attachMode: "free" },
    { attachMode: "manual" },
    { ticketId: ids[0] },
    { imported: true },
    { direction: "out" },
    { origin: "staff" },
    { text: "" },
  ]) {
    assert.equal(await classify({ message: { ...message, ...change } }), null);
  }
  assert.equal(enabledPrompts.length, 0);
});

test("closed, ended, unlinked, deleted and another company tickets never leave the server", async (t) => {
  const prompts = setup(t);
  const excluded = [
    {
      ...linkedTickets[0],
      _id: "333333333333333333333333",
      description: "SECRET_UNLINKED",
    },
    {
      ...linkedTickets[0],
      _id: "444444444444444444444444",
      description: "SECRET_CLOSED",
      isClosed: true,
    },
    {
      ...linkedTickets[0],
      _id: "555555555555555555555555",
      description: "SECRET_COMPANY",
      company: { _id: "bbbbbbbbbbbbbbbbbbbbbbbb" },
    },
    {
      ...linkedTickets[0],
      _id: "666666666666666666666666",
      description: "SECRET_ENDED",
    },
    {
      ...linkedTickets[0],
      _id: "777777777777777777777777",
      description: "SECRET_DELETED",
      deletedAt: new Date(),
    },
  ];
  await classify({
    conversation: {
      ...conversation,
      ticketBindings: [
        ...conversation.ticketBindings,
        ...excluded
          .slice(1)
          .map((ticket) => ({
            ticketId: ticket._id,
            ...(ticket.description === "SECRET_ENDED"
              ? { endedAt: new Date() }
              : {}),
          })),
      ],
    },
    linkedTickets: [...linkedTickets, ...excluded],
  });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].user.includes("SECRET_"), false);
  assert.equal(
    await classify({ conversation: { ...conversation, companyId: null } }),
    null,
  );
  assert.equal(await classify({ linkedTickets: [linkedTickets[0]] }), null);
});

test("history is bounded and scoped to this conversation and eligible tickets", async (t) => {
  const prompts = setup(t);
  const recent = {
    conversationId: conversation._id,
    ticketId: ids[0],
    direction: "out",
    text: "Проверили принтер",
    sentAt: new Date("2026-11-10T23:59:00Z"),
  };
  await classify({
    recentMessages: [
      recent,
      { ...recent, conversationId: "other", text: "SECRET_OTHER_CHAT" },
      { ...recent, ticketId: "other", text: "SECRET_OTHER_TICKET" },
      { ...recent, deletedAt: new Date(), text: "SECRET_DELETED" },
      {
        ...recent,
        sentAt: new Date("2026-11-10T22:00:00Z"),
        text: "SECRET_OLD",
      },
    ],
  });
  const prompt = JSON.parse(prompts[0].user);
  assert.equal(prompt.recentMessages.length, 1);
  assert.equal(prompt.recentMessages[0].text, recent.text);
  assert.equal(prompts[0].user.includes("SECRET_"), false);
});

test("evidence shared by several tickets is not a confident unique assignment", async (t) => {
  setup(t);
  assert.equal(
    await classify({
      linkedTickets: [
        linkedTickets[0],
        { ...linkedTickets[1], title: linkedTickets[0].title },
      ],
    }),
    null,
  );
});

test("a message from a different conversation never reaches a provider", async (t) => {
  const prompts = setup(t);
  assert.equal(
    await classify({ message: { ...message, conversationId: "other" } }),
    null,
  );
  assert.equal(prompts.length, 0);
});

test("a stalled optional provider leaves ingestion unresolved after eight seconds", async (t) => {
  setup(t);
  aiService.generateJson.mock.mockImplementation(async () => new Promise(() => {}));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = classify();
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(8_000);
  assert.equal(await pending, null);
});

test("configured local AI uses the existing provider path with grounded JSON", async (t) => {
  const health = require("../ai/health");
  t.mock.method(Preferences, "findOne", async () => ({
    messaging: { aiTicketRouting: true },
    ai: {
      isActive: true,
      provider: "local",
      local: {
        model: "support-classifier",
        baseUrl: "http://classifier.test:11434",
      },
    },
  }));
  t.mock.method(health, "recordOk", async () => {});
  t.mock.method(health, "recordError", async () => {});
  const fetch = t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url, "http://classifier.test:11434/v1/chat/completions");
    const request = JSON.parse(options.body);
    assert.equal(request.model, "support-classifier");
    assert.equal(JSON.parse(request.messages[1].content).tickets.length, 2);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
    };
  });
  assert.deepEqual(await classify(), {
    ticketId: ids[0],
    attachMode: "ai",
    confidence: 0.97,
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("a configured provider HTTP refusal is unresolved without a second attempt", async (t) => {
  const health = require("../ai/health");
  t.mock.method(Preferences, "findOne", async () => ({
    messaging: { aiTicketRouting: true },
    ai: {
      isActive: true,
      provider: "local",
      local: {
        model: "support-classifier",
        baseUrl: "http://classifier.test:11434",
      },
    },
  }));
  t.mock.method(health, "recordError", async () => {});
  const fetch = t.mock.method(global, "fetch", async () => ({
    ok: false,
    status: 503,
    text: async () => "Temporarily unavailable",
  }));
  assert.equal(await classify(), null);
  assert.equal(fetch.mock.callCount(), 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationTicketLabel,
  uniqueOtherChannels,
} from "./conversation-contact.js";

test("current Telegram handle suppresses the same contact from other channels", () => {
  const otherChannels = [
    { network: "telegram", handle: "Sokolova", conversationId: "duplicate" },
    { network: "telegram", handle: "@other", conversationId: "other" },
    { network: "whatsapp", handle: "79145550142", conversationId: null },
  ];
  assert.deepEqual(
    uniqueOtherChannels({
      network: "telegram",
      currentHandle: "@sokolova",
      otherChannels,
    }),
    otherChannels.slice(1),
  );
});

test("phone formatting does not duplicate a channel; another network remains available", () => {
  const telegram = {
    network: "telegram",
    handle: "+7 (914) 555-01-42",
    conversationId: "telegram",
  };
  const whatsapp = {
    network: "whatsapp",
    handle: "79145550142",
    conversationId: "whatsapp",
  };
  assert.deepEqual(
    uniqueOtherChannels({
      network: "whatsapp",
      currentHandle: "+7 (914) 555-01-42",
      otherChannels: [
        whatsapp,
        telegram,
        { ...telegram, handle: "79145550142" },
      ],
    }),
    [telegram],
  );
});

test("missing current handle does not hide other known channel addresses", () => {
  const otherChannels = [
    { network: "telegram", handle: "@known", conversationId: "known" },
  ];
  assert.deepEqual(
    uniqueOtherChannels({
      network: "telegram",
      currentHandle: "",
      otherChannels,
    }),
    otherChannels,
  );
});

test("ticket label retains the legacy number and respects a new empty tickets list", () => {
  assert.equal(conversationTicketLabel({ ticket: { num: 104 } }), "104");
  assert.equal(
    conversationTicketLabel({ tickets: [], ticket: { num: 104 } }),
    "Без заявки",
  );
  assert.equal(conversationTicketLabel({ tickets: [{ num: 209 }] }), "209");
});

test("ticket count uses Russian plurals including teen exceptions", () => {
  for (const [count, expected] of [
    [2, "2 заявки"],
    [3, "3 заявки"],
    [5, "5 заявок"],
    [11, "11 заявок"],
    [21, "21 заявка"],
    [22, "22 заявки"],
    [111, "111 заявок"],
  ]) {
    assert.equal(
      conversationTicketLabel({
        tickets: Array.from({ length: count }, (_, num) => ({ num })),
      }),
      expected,
    );
  }
});

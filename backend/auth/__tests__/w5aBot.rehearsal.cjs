const assert = require("node:assert/strict");

module.exports = async (t, f) => {
  const { createBot, runOutboxCycle } = await f.oldBot();
  const bot = createBot(() => null);
  const outbound = [];
  let messageId = 100;
  // Test-local grammY transport injection; never polls Telegram or uses a token
  // from a deployment. The old bot and its real outbox worker remain intact.
  bot.api.config.use(async (_previous, method, payload) => {
    if (method === "getMe") return { ok: true, result: { id: 123456, is_bot: true, first_name: "Synthetic", username: "synthetic_w5a_bot" } };
    if (method === "getFile") {
      assert.equal(payload.file_id, "synthetic-photo");
      return { ok: true, result: { file_id: "synthetic-photo", file_unique_id: "synthetic-unique", file_path: "photos/synthetic.png" } };
    }
    if (["answerCallbackQuery", "deleteMessage", "setMyCommands"].includes(method)) return { ok: true, result: true };
    assert.ok(["sendMessage", "sendRichMessage"].includes(method), `unexpected Telegram method: ${method}`);
    outbound.push({ method, ...payload });
    return { ok: true, result: { message_id: messageId++, date: 1, chat: { id: Number(payload.chat_id), type: "private" }, text: payload.text || "rich notification" } };
  });
  await bot.init();
  const originalFetch = global.fetch;
  let photoRequests = 0;
  global.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.telegram.org/file/bot123456:synthetic-never-delivered/photos/synthetic.png") {
      photoRequests++;
      return new Response(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvWQAAAAASUVORK5CYII=", "base64"), { headers: { "content-type": "image/png" } });
    }
    assert.equal(new URL(url).origin, f.origin, "all non-fixture network access is forbidden");
    return originalFetch(input, init);
  };
  try {
    const from = { id: 123456789, is_bot: false, first_name: "Synthetic" };
    const chat = { id: from.id, type: "private", first_name: "Synthetic" };
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 1, from, chat,
      photo: [{ file_id: "synthetic-photo", file_unique_id: "synthetic-unique", width: 1, height: 1 }],
      caption: "Synthetic old-bot photo continuity" } });
    await bot.handleUpdate({ update_id: 2, callback_query: { id: "synthetic-callback", from, chat_instance: "synthetic-instance", data: "newticket:yes",
      message: { message_id: 2, date: 1, from: { id: 123456, is_bot: true, first_name: "Synthetic" }, chat, text: "confirm" } } });
    const ticket = await f.db.collection("tickets").findOne({ description: "Synthetic old-bot photo continuity" });
    assert.ok(ticket, "old bot must create a persisted ticket through the real candidate router");
    assert.equal(String(ticket.applicantId), f.users.find((user) => user.label === "client").id);
    assert.equal(ticket.source, "Telegram");
    assert.equal(ticket.attachments.length, 1, "photo must survive multipart transfer");
    assert.equal(photoRequests, 1);
    // Run the existing notification producer, not a fabricated outbox row.
    await require("../../middleware/notifications").createTicketNotifications();
    const queued = await f.db.collection("notifications").findOne({ ticketId: ticket._id, instrument: "telegram", "to.chatId": "123456789" });
    assert.ok(queued, "real ticket fan-out must retain the old linked chat");
    const repliesBefore = outbound.length;
    await runOutboxCycle(bot);
    assert.ok(outbound.slice(repliesBefore).some((row) => String(row.chat_id) === "123456789"), "outbox must address the same saved chat");
    const delivered = await f.db.collection("notifications").findOne({ _id: queued._id });
    assert.equal(delivered.sent, true, "real backend must accept the fake-transport delivery acknowledgement");
    assert.equal(Object.hasOwn((await f.db.collection("users").findOne({ email: "client@example.test" })).telegramBot, "linkedAt"), false);
    t.diagnostic("Old bot + real candidate ticket/notification/outbox exercised using fake Telegram transport; NO real Telegram API delivery.");
  } finally {
    global.fetch = originalFetch;
  }
};

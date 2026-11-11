require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const ticketPath = require.resolve("@/models/ticket");
const ticketModule = new Module(ticketPath);
ticketModule.exports = { Ticket: {}, ticketDefaultFieldsSchema: {}, initializeCounter: async () => {} };
ticketModule.loaded = true;
require.cache[ticketPath] = ticketModule;
const User = require("@/models/user");
const Comment = require("@/models/comment");
const { mirrorToTicketLocked } = require("./mirror");

test("a retained messenger binding cannot write a new ticket comment as a deleted person", async () => {
  const original = { find: User.findById, commentFind: Comment.findOne, create: Comment.create };
  try {
    User.findById = () => ({ select: () => ({ lean: async () => ({ deletedAt: new Date(), banned: false }) }) });
    Comment.findOne = () => ({ select: () => ({ lean: async () => null }) });
    Comment.create = async () => { throw new Error("Deleted actor reached comment creation"); };
    const result = await mirrorToTicketLocked({ message: { _id: "message", direction: "in", attachments: [] }, ticket: { _id: "ticket" }, identity: { userId: "deleted" }, conversation: { network: "telegram" }, prefs: {} });
    assert.equal(result, null);
  } finally { User.findById = original.find; Comment.findOne = original.commentFind; Comment.create = original.create; }
});

test("mirrored messages retain a Dialogues notification marker in the comment model", async (t) => {
  let saved;
  t.mock.method(User, "findById", () => ({ select() { return this; }, lean: async () => ({ deletedAt: null }) }));
  t.mock.method(Comment, "findOne", () => ({ select() { return this; }, lean: async () => null }));
  t.mock.method(Comment, "create", async (data) => {
    saved = new Comment(data);
    return saved;
  });
  t.mock.method(Comment, "updateMany", async () => ({}));
  const Message = require("@/models/message");
  t.mock.method(Message, "updateOne", async () => ({}));
  ticketModule.exports.Ticket.updateOne = async () => ({});
  await mirrorToTicketLocked({
    message: { _id: "64f600000000000000000001", direction: "in", text: "Здравствуйте", sentAt: new Date(), attachments: [] },
    ticket: { _id: "64f600000000000000000002" },
    identity: { userId: "64f600000000000000000003" },
    conversation: { _id: "64f600000000000000000004", network: "telegram" }, prefs: {},
  });
  assert.equal(saved.notifications.fromConversation, true);
  assert.equal(saved.notifications.pending, true);
});

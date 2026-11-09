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
const { mirrorToTicket } = require("./mirror");

test("a retained messenger binding cannot write a new ticket comment as a deleted person", async () => {
  const original = { find: User.findById, commentFind: Comment.findOne, create: Comment.create };
  try {
    User.findById = () => ({ select: () => ({ lean: async () => ({ deletedAt: new Date(), banned: false }) }) });
    Comment.findOne = () => ({ select: () => ({ lean: async () => null }) });
    Comment.create = async () => { throw new Error("Deleted actor reached comment creation"); };
    const result = await mirrorToTicket({ message: { _id: "message", direction: "in", attachments: [] }, ticket: { _id: "ticket" }, identity: { userId: "deleted" }, conversation: { network: "telegram" }, prefs: {} });
    assert.equal(result, null);
  } finally { User.findById = original.find; Comment.findOne = original.commentFind; Comment.create = original.create; }
});

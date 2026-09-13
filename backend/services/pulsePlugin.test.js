// node --test services/pulsePlugin.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  updateEntries,
  classifySave,
  classifyUpdate,
  idsFromFilter,
  idsFromDoc,
  resultChanged,
} = require("./pulsePlugin");
const SPECS = require("./pulseTopics");

// Real models: directModifiedPaths naming is Mongoose's, not ours — hydrate
// documents without a database and mutate them the way the code does.
const { Ticket } = require("@/models/ticket");
const User = require("@/models/user");

const oid = () => new mongoose.Types.ObjectId();

const ticket = (extra = {}) =>
  Ticket.hydrate({
    _id: oid(),
    num: 1,
    state: "new",
    notifications: { lastAction: "add ticket", pending: true },
    responsibles: [{ _id: oid(), firstName: "A", isNotified: { telegram: false } }],
    checklist: [{ description: "step", checked: false }],
    ...extra,
  });

test("updateEntries: operators, bare keys, $setOnInsert skipped", () => {
  assert.deepEqual(
    updateEntries({ $set: { a: 1 }, $unset: { b: "" }, c: 2, $setOnInsert: { d: 3 } }),
    [
      { path: "a", value: 1, op: "$set" },
      { path: "b", value: "", op: "$unset" },
      { path: "c", value: 2, op: "$set" },
    ],
  );
  assert.deepEqual(updateEntries(null), []);
});

test("notification cron save (pending → false, isNotified latch) is not a change", () => {
  const doc = ticket();
  doc.notifications.pending = false;
  doc.responsibles[0].isNotified.telegram = true;
  assert.equal(classifySave(doc, SPECS.Ticket).meaningful, false);
});

test("lifecycle save (notifications reassigned, state) is a change", () => {
  const doc = ticket({ notifications: { lastAction: "x", pending: false } });
  doc.notifications = { lastAction: "process ticket", pending: true };
  doc.state = "inWork";
  assert.deepEqual(classifySave(doc, SPECS.Ticket), { topics: ["tickets"], meaningful: true });
});

test("the same action twice: only pending false → true is still a change", () => {
  const doc = ticket({ notifications: { lastAction: "x", pending: false } });
  doc.notifications.pending = true;
  assert.equal(classifySave(doc, SPECS.Ticket).meaningful, true);
});

test("checklist tick and responsible swap are changes", () => {
  const ticked = ticket();
  ticked.checklist[0].checked = true;
  assert.equal(classifySave(ticked, SPECS.Ticket).meaningful, true);

  const swapped = ticket();
  swapped.responsibles = [{ _id: oid(), firstName: "B" }];
  assert.equal(classifySave(swapped, SPECS.Ticket).meaningful, true);
});

test("a new document is always a change with every topic", () => {
  const doc = new User({ firstName: "N", lastName: "U", email: "n@u.test" });
  assert.deepEqual(classifySave(doc, SPECS.User), {
    topics: ["presence", "team"],
    meaningful: true,
  });
});

test("user saves route by path; a login stamp moves nothing", () => {
  const user = () => User.hydrate({ _id: oid(), firstName: "A", lastName: "B", email: "a@b.test" });

  const status = user();
  status.workStatus = { code: "office", note: "x" };
  assert.deepEqual(classifySave(status, SPECS.User).topics, ["presence"]);

  const schedule = user();
  schedule.timezone = "Europe/Moscow";
  assert.deepEqual(classifySave(schedule, SPECS.User).topics, ["team"]);

  const renamed = user();
  renamed.lastName = "C";
  assert.deepEqual(classifySave(renamed, SPECS.User).topics, ["presence", "team"]);

  const login = user();
  login.lastLogin = new Date();
  assert.deepEqual(classifySave(login, SPECS.User), { topics: [], meaningful: false });
});

test("query updates: noise vs change", () => {
  // comment hook bumping activity, AI status write
  assert.equal(classifyUpdate("updateOne", { $set: { activity: { at: new Date() } } }, SPECS.Ticket).meaningful, true);
  assert.equal(classifyUpdate("findOneAndUpdate", { "aiGuide.status": "done" }, SPECS.Ticket).meaningful, true);
  // cron-style update
  assert.equal(classifyUpdate("updateOne", { $set: { "notifications.pending": false, updatedAt: new Date() } }, SPECS.Ticket).meaningful, false);
  // user bookkeeping
  assert.equal(classifyUpdate("updateOne", { $set: { lastActivityAt: new Date() } }, SPECS.User).meaningful, false);
  assert.deepEqual(classifyUpdate("updateMany", { $set: { "workStatus.code": "unset" } }, SPECS.User).topics, ["presence"]);
  // deletes are always changes
  assert.deepEqual(classifyUpdate("deleteOne", undefined, SPECS.Work), { topics: ["tickets", "approval"], meaningful: true });
});

test("Mikrotik monitoring writes (exact monitorState shapes) are noise; alerts and edits are not", () => {
  const now = new Date();
  const recover = {
    $set: {
      name: "r1",
      boardName: "hEX",
      currentFirmware: "7.15",
      addresses: [],
      serialNumber: "S1",
      status: "online",
      lastSuccessfulConnectionAt: now,
      lastCheckedAt: now,
      failedPolls: 0,
      "credentials.tlsCert": "pem",
    },
    $unset: { lastError: "", offlineSince: "", offlineAlertedAt: "", alertTicketId: "", firstFailureAt: "" },
  };
  const failure = { $inc: { failedPolls: 1 }, $min: { firstFailureAt: now }, $set: { lastCheckedAt: now, lastError: "timeout" } };
  const confirm = { $set: { status: "offline", offlineSince: now } };
  const pinKey = { $set: { "credentials.sshHostKey": "fp" } };
  for (const update of [recover, failure, confirm, pinKey]) {
    assert.equal(classifyUpdate("findOneAndUpdate", update, SPECS.Mikrotik).meaningful, false);
  }

  const alertClaim = { $set: { offlineAlertedAt: now } };
  const alertTicket = { $set: { alertTicketId: oid() } };
  const disconnect = { $set: { monitoringEnabled: false, status: "offline", failedPolls: 0 }, $unset: { offlineSince: "" } };
  for (const update of [alertClaim, alertTicket, disconnect]) {
    assert.equal(classifyUpdate("updateOne", update, SPECS.Mikrotik).meaningful, true);
  }
});

test("idsFromFilter: scalar, ObjectId, $in, $eq, absent", () => {
  const id = oid();
  assert.deepEqual(idsFromFilter({ _id: id }, "_id"), [String(id)]);
  assert.deepEqual(idsFromFilter({ _id: String(id) }, "_id"), [String(id)]);
  assert.deepEqual(idsFromFilter({ _id: { $in: [id, "x"] } }, "_id"), [String(id), "x"]);
  assert.deepEqual(idsFromFilter({ userId: { $eq: id } }, "userId"), [String(id)]);
  assert.equal(idsFromFilter({ state: "new" }, "_id"), null);
  assert.equal(idsFromFilter({ _id: { $gt: id } }, "_id"), null);
});

test("idsFromDoc: self, scalar ref, array ref, lean rows", () => {
  const doc = ticket();
  assert.deepEqual(idsFromDoc(doc, "self"), [String(doc._id)]);
  const a = oid();
  const b = oid();
  assert.deepEqual(idsFromDoc({ tickets: [a, b] }, "tickets"), [String(a), String(b)]);
  assert.deepEqual(idsFromDoc({ ticketId: a }, "ticketId"), [String(a)]);
  assert.deepEqual(idsFromDoc({}, "ticketId"), []);
  assert.deepEqual(idsFromDoc(doc, undefined), []);
});

test("resultChanged: update/delete counts, returned documents, metadata results", () => {
  assert.equal(resultChanged({ matchedCount: 1, modifiedCount: 0, upsertedCount: 0 }), false);
  assert.equal(resultChanged({ matchedCount: 1, modifiedCount: 1 }), true);
  assert.equal(resultChanged({ modifiedCount: 0, upsertedCount: 1 }), true);
  assert.equal(resultChanged({ deletedCount: 0 }), false);
  assert.equal(resultChanged({ deletedCount: 2 }), true);
  assert.equal(resultChanged(null), false);
  assert.equal(resultChanged({ _id: oid() }), true);
  assert.equal(resultChanged({ ok: 1, value: null }), false);
});

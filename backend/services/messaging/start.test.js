require("module-alias/register");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;
const stub = (path, exports) => { const id = require.resolve(path), entry = new Module(id); Object.assign(entry, { filename: id, loaded: true, exports }); require.cache[id] = entry; };
const query = (value) => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value });
const USER = "64f600000000000000000001", STAFF = "64f600000000000000000002", CHANNEL = "64f600000000000000000003", CHAT = "64f600000000000000000004", MESSAGE = "64f600000000000000000005";
let users, conversations, identities, channels, queued, message, active;
const auth = { userId: STAFF, isAdmin: true, can: () => true };
stub("@/models/ticket", { Ticket: { find: () => query([]) } });
stub("@/models/user", { findById: (id) => query(users.find(u => u._id === id)), find: (filter) => query(users.filter(sift(filter))) });
stub("@/models/conversation", { find: (filter) => query(conversations.filter(sift(filter))), findById: (id) => query(conversations.find(c => c._id === id)) });
stub("@/models/channelIdentity", { find: (filter) => query(identities.filter(sift(filter))) });
stub("@/models/channel", { find: (filter) => query(channels.filter(sift(filter))) });
stub("@/models/message", { findById: () => query(message), findOne: () => query(null) });
stub("@/models/preferences", { findOne: () => query({ modules: { messaging: { isActive: active } } }) });
stub("./outbound", { attachmentsOf: files => files, queueOutbound: async data => { queued.push(data); return { _id: MESSAGE, conversationId: null, status: "queued" }; } });
const start = require("./start");
const startImpl = start.startConversation;
start.startConversation = args => startImpl({ clientRequestId: "2dd2b92e-94f4-4d2c-9e1d-6711b1b61d55", ...args });
beforeEach(() => {
  users = [{ _id: USER, firstName: "Иван", phone: "79145550142", company: { _id: "company", alias: "Лютик" } }, { _id: STAFF, firstName: "Сотрудник" }];
  channels = [{ _id: CHANNEL, type: "telegram", provider: "wazzup", providerTransport: "tgapi", isActive: true }]; conversations = []; identities = []; queued = []; message = null; active = true;
});
test("recipient input rejects ambiguous and untyped input at the boundary", () => {
  for (const input of [{}, { userId: USER, phone: "79145550142" }, { phone: ["79145550142"] }, { userId: {} }, { phone: "123" }]) assert.throws(() => start.recipientInput(input), /получателя|телефон|номер/i);
  assert.deepEqual(start.recipientInput({ phone: "+7 (914) 555-01-42" }), { phone: "79145550142" });
});
test("phone start queues inbox-only message without a user or ticket", async () => {
  const result = await start.startConversation({ phone: "+7 (914) 555-01-42", routeId: `phone:${CHANNEL}`, text: "Здравствуйте", files: [], auth });
  assert.equal(result.messageId, MESSAGE); assert.equal(result.conversationId, null); assert.equal(result.status, "queued"); assert.equal(queued.length, 1); assert.equal(queued[0].recipient.phone, "79145550142"); assert.equal(queued[0].ticket, undefined);
});
test("userId address comes from current server card and refuses client phone override", async () => {
  await assert.rejects(start.startConversation({ userId: USER, phone: "79990000000", routeId: `phone:${CHANNEL}`, text: "Hi", auth }), /получателя/i);
  await start.startConversation({ userId: USER, routeId: `phone:${CHANNEL}`, text: "Hi", auth });
  assert.equal(queued[0].recipient.phone, users[0].phone); assert.equal(queued[0].recipient.userId, USER);
});
test("existing linked chat replaces phone route; forged POST cannot create duplicate", async () => {
  identities = [{ _id: "identity", userId: USER, phone: users[0].phone }]; conversations = [{ _id: CHAT, channelId: CHANNEL, counterpartIdentityId: "identity", kind: "direct", network: "telegram", title: "Иван" }];
  const { routes } = await start.startRoutes({ userId: USER, auth });
  assert.equal(routes.length, 1); assert.equal(routes[0].target, "conversation"); assert.equal(routes[0].conversationId, CHAT);
  await assert.rejects(start.startConversation({ userId: USER, routeId: `phone:${CHANNEL}`, text: "Hi", auth }), /не найден|существующий/i); assert.equal(queued.length, 0);
});
test("hidden and out-of-scope chats cannot be bypassed by phone initiation", async () => {
  conversations = [{ _id: CHAT, channelId: CHANNEL, kind: "direct", deliveryPhone: users[0].phone, hidden: true }];
  let result = await start.startRoutes({ phone: users[0].phone, auth }); assert.equal(result.routes[0].available, false); assert.equal(result.routes[0].conversationId, null);
  const restricted = { userId: STAFF, can: request => Boolean(request.conversation) && !request.conversation.includes("readAll"), legacy: {} };
  users[0].company = null; conversations[0] = { ...conversations[0], hidden: false, companyId: "outside" }; result = await start.startRoutes({ phone: users[0].phone, auth: restricted }); assert.equal(result.routes[0].available, false); assert.equal(result.routes[0].conversationId, null);
});
test("permissions, module and recipient eligibility are checked before writes", async () => {
  const args = { userId: USER, routeId: `phone:${CHANNEL}`, text: "Hi", auth };
  await assert.rejects(start.startConversation({ ...args, auth: { can: () => false } }), /прав/); active = false; await assert.rejects(start.startConversation(args), /выключен/); active = true;
  for (const field of ["deletedAt", "banned", "isServiceAccount", "isCloudTelephony"]) { users[0][field] = true; await assert.rejects(start.startConversation(args), /не найден/); delete users[0][field]; }
  await assert.rejects(start.startConversation({ ...args, text: { text: "hi" } }), /текст/i); await assert.rejects(start.startConversation({ ...args, text: "" }), /Пустое/); assert.equal(queued.length, 0);
});
test("start recipient search is independent from ticket company scope", async () => {
  users.push({ _id: "bad", firstName: "Иван", banned: true }, { _id: "deleted", firstName: "Иван", deletedAt: new Date() }, { _id: "service", firstName: "Иван", isServiceAccount: true });
  assert.deepEqual((await start.startRecipients({ q: "Иван", auth })).items.map(u => u.id), [USER]);
  const restricted = { userId: STAFF, can: request => Boolean(request.conversation) && !request.conversation.includes("readAll"), legacy: {} }; assert.deepEqual((await start.startRecipients({ q: "Иван", auth: restricted })).items.map(u => u.id), [USER]);
});
test("pending outgoing status belongs only to its sender and rechecks visibility after attachment", async () => {
  message = { _id: MESSAGE, direction: "out", origin: "hd", authorUserId: STAFF, recipientPhone: "79145550142", status: "queued" };
  assert.equal((await start.outgoingStatus({ messageId: MESSAGE, auth })).status, "queued"); await assert.rejects(start.outgoingStatus({ messageId: MESSAGE, auth: { ...auth, userId: USER } }), /не найден/);
  conversations = [{ _id: CHAT, hidden: true }]; message.conversationId = CHAT; await assert.rejects(start.outgoingStatus({ messageId: MESSAGE, auth }), /не найден/);
});
test("request retry after lost response returns the same durable receipt without queueing twice", async () => {
  const model = require("@/models/message");
  const original = model.findOne;
  let accepted;
  model.findOne = () => query(accepted);
  try {
    const args = { phone: "79145550142", routeId: `phone:${CHANNEL}`, text: "Hi", auth };
    const first = await start.startConversation(args);
    accepted = { _id: first.messageId, direction: "out", origin: "hd", authorUserId: STAFF, status: "queued", clientRequestId: queued[0].clientRequestId };
    const second = await start.startConversation(args);
    assert.equal(second.messageId, first.messageId); assert.equal(second.duplicate, true); assert.equal(queued.length, 1);
    assert.equal((await start.startRequestStatus({ clientRequestId: accepted.clientRequestId, auth })).messageId, MESSAGE);
  } finally { model.findOne = original; }
});
test("request id must be a UUID and cannot alias another author's accepted send", async () => {
  await assert.rejects(start.startConversation({ phone: "79145550142", routeId: `phone:${CHANNEL}`, text: "Hi", clientRequestId: "request", auth }), /идентификатор отправки/);
  assert.equal(queued.length, 0);
});

test("hidden chat also blocks first contact through a different messenger account", async () => {
  conversations = [{ _id: CHAT, channelId: "other-channel", kind: "direct", deliveryPhone: users[0].phone, hidden: true }];
  await assert.rejects(start.startConversation({ phone: users[0].phone, routeId: `phone:${CHANNEL}`, text: "Hi", auth }), /нельзя|недоступен/);
  assert.equal(queued.length, 0);
});
test("concurrent duplicate insert reloads winner and only cleans duplicate upload keys", async () => {
  const model = require("@/models/message"), out = require("./outbound");
  const findOne = model.findOne, enqueue = out.queueOutbound;
  let reads = 0;
  const winner = { _id: MESSAGE, direction: "out", origin: "hd", authorUserId: STAFF, status: "queued", attachments: [{ name: "retained" }] };
  model.findOne = () => query(++reads > 1 ? winner : null);
  // queueOutbound is imported once; trigger E11000 through the captured stub.
  const originalPush = queued.push;
  queued.push = () => { const error = new Error("duplicate"); error.code = 11000; throw error; };
  try {
    const result = await start.startConversation({ phone: users[0].phone, routeId: `phone:${CHANNEL}`, text: "Hi", files: [{ key: "retained" }, { key: "duplicate" }], auth });
    assert.equal(result.messageId, MESSAGE); assert.deepEqual(result.cleanupKeys, ["duplicate"]);
  } finally { model.findOne = findOne; out.queueOutbound = enqueue; queued.push = originalPush; }
});
test("raw phone permits other companies but cannot bypass ban or deletion", async () => {
  const restricted = { userId: STAFF, can: request => Boolean(request.conversation) && !request.conversation.includes("readAll"), legacy: {} };
  assert.equal((await start.startRoutes({ phone: users[0].phone, auth: restricted })).routes[0].available, true);
  for (const field of ["deletedAt", "banned", "isServiceAccount", "isCloudTelephony"]) {
    users[0][field] = true; await assert.rejects(start.startRoutes({ phone: users[0].phone, auth }), /не найден/); delete users[0][field];
  }
  assert.equal(queued.length, 0);
});
test("validation-error upload cleanup never deletes keys retained by an accepted request", async () => {
  const model = require("@/models/message"), original = model.findOne;
  model.findOne = () => query({ attachments: [{ name: "retained" }] });
  try {
    assert.deepEqual(await start.rejectedUploadKeys({ clientRequestId: "2dd2b92e-94f4-4d2c-9e1d-6711b1b61d55", auth, files: [{ key: "retained" }, { key: "duplicate" }] }), ["duplicate"]);
  } finally { model.findOne = original; }
});

test('starting independently requires start, reply, and either inbox read level',async()=>{
 const makeAuth=rights=>({userId:STAFF,can:r=>Object.entries(r).every(([key,values])=>values.every(v=>rights.includes(`${key}.${v}`)))});
 for(const rights of [['conversation.read','conversation.reply'],['conversation.readAll','conversation.start'],['conversation.reply','conversation.start']]) {
  await assert.rejects(start.requireStartAccess(makeAuth(rights)),/прав/);
 }
 await start.requireStartAccess(makeAuth(['conversation.read','conversation.reply','conversation.start']));
 await start.requireStartAccess(makeAuth(['conversation.readAll','conversation.reply','conversation.start']));
});

test('own start receipt survives canonical attachment without granting chat history',async()=>{
 const limited={userId:STAFF,can:r=>Boolean(r.conversation)&&r.conversation.every(v=>['read','reply','start'].includes(v))};
 message={_id:MESSAGE,direction:'out',origin:'hd',authorUserId:STAFF,recipientPhone:'79145550142',clientRequestId:'2dd2b92e-94f4-4d2c-9e1d-6711b1b61d55',conversationId:CHAT,status:'failed'};
 conversations=[{_id:CHAT,channelId:CHANNEL,kind:'direct',hidden:false}];
 assert.equal((await start.outgoingStatus({messageId:MESSAGE,auth:limited})).messageId,MESSAGE);
 const model=require('@/models/message'),original=model.findOne;model.findOne=()=>query(message);
 try {
  assert.equal((await start.startConversation({phone:'79145550142',routeId:`phone:${CHANNEL}`,text:'Hi',auth:limited})).duplicate,true);
  assert.equal((await start.startRequestStatus({clientRequestId:message.clientRequestId,auth:limited})).messageId,MESSAGE);
  assert.equal(queued.length,0);
 } finally {model.findOne=original;}
 await assert.rejects(start.outgoingStatus({messageId:MESSAGE,auth:{...limited,userId:USER}}),/не найден/);
 delete message.clientRequestId;
 await assert.rejects(start.outgoingStatus({messageId:MESSAGE,auth:limited}),/не найден/);
});

test("restricted recipient refusal explains permission and own-ticket alternative without chat details", async () => {
  const restricted = { userId: STAFF, can: request => Boolean(request.conversation) && !request.conversation.includes('readAll') };
  conversations = [{ _id: CHAT, channelId: CHANNEL, kind: 'direct', deliveryPhone: users[0].phone }];
  const result = await start.startRoutes({ phone: users[0].phone, auth: restricted });
  assert.equal(result.routes[0].available, false);
  assert.match(result.routes[0].reason, /правам/);
  assert.match(result.routes[0].reason, /из карточки.*заявки/);
  assert.equal(result.routes[0].conversationId, null);
  assert.equal(result.routes[0].reason.includes(CHAT), false);
});

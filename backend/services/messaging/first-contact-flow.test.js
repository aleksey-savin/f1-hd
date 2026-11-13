require("module-alias/register");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const stub = (path, exports) => {
  const id = require.resolve(path), entry = new Module(id);
  Object.assign(entry, { filename: id, loaded: true, exports });
  require.cache[id] = entry;
};
const query = (value) => ({ then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }, select() { return this; }, lean: async () => value });
const TICKET = "64f600000000000000000001", CHANNEL = "64f600000000000000000002", MESSAGE = "64f600000000000000000003", CONVERSATION = "64f600000000000000000004";
let recipient, routeList, message, jobs, commentWrites, canonical, bindings, seq, failLink, known, networkAuth, createdComments, savedContext, bindingCalls, foreignWaiting, conversationWrites;
const ticket = { _id: TICKET, num: 42, applicantId: "client", responsibles: [{ _id: "staff" }], isClosed: false };
const channel = { _id: CHANNEL, type: "telegram", provider: "wazzup", providerTransport: "tgapi", providerChannelId: "remote", isActive: true, settings: { signReplies: true } };
stub("@/models/conversationRead", { findOne: () => query(savedContext ? { replyContext: savedContext } : null), updateOne: async (_filter, update) => { savedContext = update.$set.replyContext; } });
stub("@/models/ticket", { Ticket: { findById: () => query(ticket), updateOne: async () => {} } });
stub("@/models/user", { findById: () => query(recipient) });
stub("@/models/preferences", { findOne: () => query({ modules: { messaging: { isActive: true } }, contacts: { title: "Техноцентр" } }) });
stub("@/models/channel", { findById: () => query(channel) });
stub("@/models/comment", { create: async data => { const comment = { ...data, _id: "comment" }; createdComments.push(comment); return comment; }, updateOne: async (filter, update) => commentWrites.push({ filter, update }) });
stub("@/models/message", {
  exists: async () => foreignWaiting ? { _id: "foreign" } : null,
  create: async (data) => { message = { ...data, _id: data._id || MESSAGE, save: async () => {}, toObject() { return this; } }; return message; },
  findById: () => Object.assign(Promise.resolve(message), query(message)),
  updateOne: async (filter, update) => {
    if (filter.conversationId === null && message.conversationId !== null) return { modifiedCount: 0 };
    if (filter.status && message.status !== filter.status) return { modifiedCount: 0 };
    Object.assign(message, update.$set);
    for (const key of Object.keys(update.$unset || {})) delete message[key];
    return { modifiedCount: 1 };
  },
});
stub("@/models/channelJob", {
  create: async (data) => { const job = { ...data, _id: data._id || `job-${jobs.length}` }; jobs.push(job); return job; },
  findById: id => query(jobs.find(job => String(job._id) === String(id))),
  updateOne: async () => { if (failLink) { failLink = false; throw new Error("temporary DB failure"); } return { matchedCount: 1 }; },
  updateMany: async () => {},
});
stub("@/models/conversation", {
  find: () => query(known),
  findById: () => query(canonical),
  findOneAndUpdate: () => query({ lastSeq: ++seq }),
  updateOne: async (filter, change) => { conversationWrites.push({filter,change}); },
});
stub("@/models/channelIdentity", { find: () => query([]) });
stub("@/services/ticketSeen", { markSeen: async () => {} });
stub("@/services/pulse", { bus: { bump() {} } });
stub("@/services/storage", { copyObject: async () => assert.fail("no attachments in this case") });
stub("./origin", { deliveryRoutes: async () => ({ routes: routeList }) });
stub("./identity", { resolveIdentity: async () => ({ _id: "identity", userId: null }), modelDeps: () => ({}) });
stub("./ingest", { upsertConversation: async () => canonical });
stub("./bindings", { bindConversation: async (options) => { const { conversation, ticket } = options; bindingCalls.push(options); bindings++; conversation.binding = { ticketId: ticket._id }; } });
const { validateDeliverRoute, deliverComment, retryMessage } = require("./outbound");
const { attachFirstContact, inspectPhoneJob } = require("./first-contact");
const auth = { userId: "staff", isAdmin: true, can: () => true };
stub("@/services/authContext", { buildAuthContext: async () => networkAuth, isDeniedAccount: user => Boolean(user.banned) });
beforeEach(() => {
  recipient = { _id: "client", firstName: "Клиент", phone: "+7 (914) 555-01-42" };
  routeList = [{ id: `phone:${CHANNEL}`, target: "phone", channelId: CHANNEL, conversationId: null, available: true }];
  jobs = []; commentWrites = []; bindings = 0; bindingCalls = []; seq = 0; failLink = false; message = null;
  canonical = { _id: CONVERSATION, channelId: CHANNEL, externalChatId: "remote-peer", network: "telegram", kind: "direct", binding: {} };
  foreignWaiting = false; conversationWrites = []; known = []; networkAuth = auth; createdComments = []; savedContext = null; ticket.isClosed = false;
});
const send = async () => {
  const route = await validateDeliverRoute({ ticket, routeId: `phone:${CHANNEL}`, auth });
  assert.equal(route.conversation, null);
  assert.equal(route.recipient.phone, "79145550142");
  assert.equal(route.skipApplicant, true);
  await deliverComment({ ticket, route, comment: { _id: "comment", content: "Здравствуйте!", attachments: [] }, author: { _id: "staff", firstName: "Алексей", lastName: "Савин" } });
  return jobs[0];
};

test("first contact queues a real ticket reply without an existing conversation, using only the server phone", async () => {
  const job = await send();
  assert.equal(message.conversationId, null);
  assert.equal(message.recipientPhone, "79145550142");
  assert.equal(message.commentId, "comment");
  assert.equal(job.conversationId, null);
  assert.equal(job.orderingKey, `phone:${CHANNEL}:79145550142`);
  assert.deepEqual(job.payload.recipient, { phone: "79145550142" });
  assert.equal(job.payload.text, "Здравствуйте!\n\n42\n\n- Алексей, Техноцентр");
  assert.equal(message.text, "Здравствуйте!");
  assert.equal(job.payload.chatId, undefined);
  assert.ok(commentWrites.some((entry) => String(entry.update.$set?.["channel.messageId"]) === String(message._id)));
});

test("forged route, revoked reply permission, and missing server phone cannot enqueue", async () => {
  await assert.rejects(validateDeliverRoute({ ticket, routeId: "phone:another-channel", auth }), /не найден/);
  await assert.rejects(validateDeliverRoute({ ticket, routeId: `phone:${CHANNEL}`, auth: { can: () => false } }), /прав/);
  recipient.phone = "";
  await assert.rejects(validateDeliverRoute({ ticket, routeId: `phone:${CHANNEL}`, auth }), /номер/);
  assert.equal(jobs.length, 0);
});

test("provider acceptance links the same message and comment to canonical conversation; retry converges after partial failure", async () => {
  const job = await send();
  failLink = true;
  await assert.rejects(attachFirstContact(job, channel, { chatId: "real-peer" }), /temporary/);
  assert.equal(message.conversationId, CONVERSATION);
  const assignedSeq = message.seq;
  await attachFirstContact(job, channel, { chatId: "real-peer" });
  await attachFirstContact(job, channel, { chatId: "real-peer" });
  assert.equal(message.seq, assignedSeq);
  assert.equal(seq, 1);
  assert.equal(bindings, 1);
  assert.equal(jobs.length, 1);
  assert.equal(message.externalChatId, "real-peer");
  assert.ok(commentWrites.some((entry) => entry.update.$set?.["channel.conversationId"] === CONVERSATION));
});

test("resolving to a conversation bound to another ticket never steals its binding", async () => {
  const job = await send();
  canonical.binding = { ticketId: "another-ticket" };
  await attachFirstContact(job, channel, { chatId: "real-peer" });
  assert.equal(canonical.binding.ticketId, "another-ticket");
  assert.equal(bindings, 0);
});

test("explicit retry after accepted first contact resumes provider progress instead of sending accepted parts again", async () => {
  await send();
  jobs[0].result = { nextPart: 1, externalIds: ["accepted"], chatId: "real-peer", inFlightPart: 1 };
  message.status = "failed";
  message.externalIds = ["accepted"];
  await retryMessage({ messageId: MESSAGE, auth });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].result.chatId, "real-peer");
  assert.equal(jobs[1].result.nextPart, 1);
  assert.equal(jobs[1].result.inFlightPart, null);
  assert.deepEqual(message.externalIds, ["accepted"]);
});

test("two tickets queued before chat exists: second is blocked before HTTP once first binds canonical chat", async () => {
  const job = await send();
  assert.equal((await inspectPhoneJob(job, channel)).reason, undefined);
  known = [{ ...canonical, binding: { ticketId: "other-ticket", ticketNum: 77 } }];
  assert.match((await inspectPhoneJob(job, channel)).reason, /занят заявкой 77/);
  known[0].binding.ticketId = TICKET;
  assert.equal((await inspectPhoneJob(job, channel)).reason, undefined);
  known[0].hidden = true;
  assert.match((await inspectPhoneJob(job, channel)).reason, /скрыт/);
});

test("real outbox worker rechecks first-contact binding before network and links accepted result", async (t) => {
  const job = await send();
  const queues = require("./jobs");
  const provider = require("../wazzup/provider");
  const sends = [], acks = [];
  t.mock.method(queues, "leaseJobs", async () => ({ leaseId: "lease", jobs: [job] }));
  t.mock.method(queues, "ackJobs", async (lease, results) => acks.push(results[0]));
  t.mock.method(require("../crypto/secretBox"), "decryptSecret", () => "test-key");
  t.mock.method(provider, "sendMessage", async (key, body) => { sends.push(body); return { messageId: "sent-first", chatId: "resolved-chat" }; });
  const settingsModel = require("@/models/wazzupSettings");
  t.mock.method(settingsModel, "updateOne", async () => {});
  const { sendOutbox } = require("../wazzup/worker");
  const settings = { isActive: true, apiKey: "encrypted", channelIds: ["remote"] };
  known = [{ ...canonical, binding: { ticketId: "other-ticket", ticketNum: 77 } }];
  await sendOutbox(settings);
  assert.equal(sends.length, 0);
  assert.equal(acks[0].ok, false);
  assert.match(acks[0].error, /занят заявкой 77/);
  known = [];
  await sendOutbox(settings);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].phone, "79145550142");
  assert.equal(sends[0].chatId, undefined);
  assert.equal(message.conversationId, CONVERSATION);
  assert.equal(acks[1].ok, true);
  assert.equal(acks[1].result.chatId, "resolved-chat");
  assert.equal(acks[1].result.recipientAttached, true);
  // Сбой после доказанно принятой последней части: остаётся только связать
  // запись. Чужая новая привязка не повод навсегда оставить её без диалога.
  message.conversationId = null;
  canonical.binding = { ticketId: "other-ticket", ticketNum: 77 };
  known = [canonical];
  job.result = { nextPart: 1, inFlightPart: null, externalIds: ["sent-first"], chatId: "resolved-chat" };
  await sendOutbox(settings);
  assert.equal(sends.length, 1);
  assert.equal(acks[2].ok, true);
  assert.equal(message.conversationId, CONVERSATION);
  assert.equal(canonical.binding.ticketId, "other-ticket");
});
test("inbox-only first contact attaches a canonical chat without ticket or comment", async () => {
  const job = await send(); message.ticketId = null; message.commentId = null; commentWrites = [];
  await attachFirstContact(job, channel, { chatId: "real-peer" });
  assert.equal(message.conversationId, CONVERSATION); assert.equal(bindings, 0); assert.equal(commentWrites.length, 0);
});
test("ticket messenger reply requires ticket.sendMessage independently from inbox reply", async () => {
  const ticketOnly = { ...auth, can: request => Boolean(request.ticket?.includes("sendMessage")) };
  await validateDeliverRoute({ ticket, routeId: `phone:${CHANNEL}`, auth: ticketOnly });
  await assert.rejects(validateDeliverRoute({ ticket, routeId: `phone:${CHANNEL}`, auth: { ...auth, isAdmin: false, can: request => Boolean(request.conversation?.includes("reply")) } }), /прав/);
});

test("inbox worker rechecks current author permission, server phone and hidden chat before HTTP", async () => {
  const job = await send(); message.ticketId = null; message.commentId = null; message.recipientUserId = "client";
  assert.equal((await inspectPhoneJob(job, channel)).reason, undefined);
  networkAuth = { ...auth, can: () => false };
  assert.match((await inspectPhoneJob(job, channel)).reason, /прав/);
  networkAuth = auth; recipient.phone = "79990000000";
  assert.match((await inspectPhoneJob(job, channel)).reason, /Номер получателя изменился/);
  recipient.phone = "79145550142"; known = [{ ...canonical, hidden: true }];
  assert.match((await inspectPhoneJob(job, channel)).reason, /скрыт/);
});
test("retry allows inbox permission for bound messages and ticket permission for own ticket", async () => {
  await send(); message.status = "failed"; message.conversationId = CONVERSATION;
  const inboxOnly = { ...auth, can: request => Boolean(request.conversation) };
  await retryMessage({ messageId: MESSAGE, auth: inboxOnly });
  message.status = "failed";
  const ticketOnly = { ...auth, can: request => Boolean(request.ticket?.includes("sendMessage")) };
  await retryMessage({ messageId: MESSAGE, auth: ticketOnly });
  message.status = "failed";
  await assert.rejects(retryMessage({ messageId: MESSAGE, auth: { ...auth, can: () => false } }), /прав|не найден/);
});
test("durable inbox-only queue persists recipient and request without creating a comment or ticket binding", async () => {
  const { queueOutbound } = require("./outbound");
  const clientRequestId = "2dd2b92e-94f4-4d2c-9e1d-6711b1b61d55";
  await queueOutbound({ channel, text: "Первое сообщение", attachments: [], author: { _id: "staff", firstName: "Алексей" }, recipient: { phone: "79145550142", name: "Клиент", userId: "client" }, clientRequestId });
  assert.equal(message.clientRequestId, clientRequestId); assert.equal(message.recipientUserId, "client"); assert.equal(message.ticketId, null); assert.equal(message.commentId, null); assert.equal(message.conversationId, null);
  assert.equal(jobs.length, 1); assert.equal((await inspectPhoneJob(jobs[0], channel)).reason, undefined);
  await attachFirstContact(jobs[0], channel, { chatId: "real-peer" });
  assert.equal(message.conversationId, CONVERSATION); assert.equal(bindings, 0); assert.equal(commentWrites.length, 0);
});

test("inbox reply decorates a live bound-ticket send while stored message and comment stay original", async () => {
  const { sendFromInbox } = require("./outbound");
  canonical.binding = { ticketId: TICKET };
  await sendFromInbox({ conversationId: CONVERSATION, text: "Ответ клиенту", auth });
  assert.equal(message.text, "Ответ клиенту"); assert.equal(createdComments[0].content, "Ответ клиенту");
  assert.equal(createdComments[0].notifications.fromConversation, true);
  assert.equal(jobs[0].payload.text, "Ответ клиенту\n\n42\n\n- Клиент, Техноцентр");
  canonical.binding.endedAt = new Date();
  await sendFromInbox({ conversationId: CONVERSATION, text: "Без заявки", auth, withoutTicket: true });
  assert.equal(message.ticketId, null); assert.equal(jobs[1].payload.text, "Без заявки\n\n- Клиент, Техноцентр");
  canonical.binding.endedAt = null; ticket.isClosed = true;
  await sendFromInbox({ conversationId: CONVERSATION, text: "Заявка закрыта", auth, withoutTicket: true });
  assert.equal(message.ticketId, null); assert.equal(jobs[2].payload.text, "Заявка закрыта\n\n- Клиент, Техноцентр");
  assert.equal(createdComments.length, 1);
});


test("an implicit remembered free reply stays deliberately free when pending messages are later attached", async () => {
  savedContext = { ticketId: null, withoutTicket: true, expiresAt: new Date(Date.now() + 60_000) };
  await require("./outbound").sendFromInbox({ conversationId: CONVERSATION, text: "Личный вопрос", auth });
  assert.equal(message.ticketId, null);
  assert.equal(message.attachMode, "free");
});


test("known legacy direct chat adds an explicit ticket reply without requiring inbox read or manual binding", async () => {
  canonical.binding = { ticketId: "other-ticket", ticketNum: 77 };
  routeList = [{ id: CONVERSATION, conversationId: CONVERSATION, available: true }];
  const ticketOnly = { userId: "staff", can: request => Boolean(request.ticket?.includes("sendMessage")) };
  const route = await validateDeliverRoute({ ticket, routeId: CONVERSATION, auth: ticketOnly });
  await deliverComment({ ticket, route, comment: { _id: "comment", content: "Ответ по второй заявке", attachments: [] }, author: { _id: "staff", firstName: "Алексей" } });
  assert.equal(bindingCalls.length, 1);
  assert.equal(bindingCalls[0].onlyIfUnbound, false);
  assert.equal(bindingCalls[0].attachPending, false);
  assert.equal(message.ticketId, TICKET);
  assert.equal(jobs.length, 1);
});

test("first-contact phone guard still rejects a foreign canonical link after multi-ticket migration", async () => {
  const job = await send();
  known = [{ ...canonical, binding: { ticketId: TICKET }, ticketBindings: [{ ticketId: "other-ticket", ticketNum: 77 }] }];
  assert.match((await inspectPhoneJob(job, channel)).reason, /занят заявкой 77/);
});
test('ticket sticker uses the messenger queue without sending the comment label or signature',async()=>{
 const storage=require('@/services/storage');const original=storage.copyObject;
 storage.copyObject=async name=>`copy-${name}`;
 try{
  const comment={_id:'sticker-comment',content:'Стикер',channel:{isSticker:true},attachments:[{name:'sticker.webp',originalName:'sticker.webp',mimetype:'image/webp'}]};
  await deliverComment({comment,ticket,route:{conversation:null,channel,recipient:{phone:'79145550142'}},author:{_id:'staff',firstName:'Алексей'}});
  assert.equal(message.kind,'sticker');assert.equal(message.text,'');
  assert.equal(jobs.at(-1).payload.text,'');assert.equal(jobs.at(-1).payload.attachments.length,1);
 }finally{storage.copyObject=original;}
});

test('ticket sending and retry reject former responsibility and closed tickets',async()=>{
 const restricted={userId:'staff',can:r=>Object.entries(r).every(([key,values])=>values.every(v=>['ticket.sendMessage','conversation.read','conversation.reply'].includes(`${key}.${v}`)))};
 const job=await send();
 ticket.messagingReaderIds=['staff']; ticket.responsibles=[];
 try {
  await assert.rejects(validateDeliverRoute({ticket,routeId:`phone:${CHANNEL}`,auth:restricted}),/недоступна/);
  await assert.rejects(retryMessage({messageId:message._id,auth:restricted}),/не найдено/);
  networkAuth=restricted;
  assert.match((await inspectPhoneJob(job,channel)).reason,/недоступна/);
  ticket.responsibles=[{_id:'staff'}]; ticket.isClosed=true;
  await assert.rejects(validateDeliverRoute({ticket,routeId:`phone:${CHANNEL}`,auth:restricted}),/недоступна/);
  assert.match((await inspectPhoneJob(job,channel)).reason,/недоступна/);
 } finally {ticket.responsibles=[{_id:'staff'}];ticket.isClosed=false;delete ticket.messagingReaderIds;}
});
test('own-ticket inbox reply can initiate without ticket.sendMessage',async()=>{
 const specialist={userId:'staff',can:r=>Object.entries(r).every(([key,values])=>values.every(v=>['conversation.read','conversation.reply'].includes(`${key}.${v}`)))};
 assert.equal((await validateDeliverRoute({ticket,routeId:`phone:${CHANNEL}`,auth:specialist})).target,'phone');
});

test('worker continues only the exact accepted own start after canonical attachment',async(t)=>{
 const job=await send();
 message.ticketId=null; message.commentId=null;
 message.clientRequestId='2dd2b92e-94f4-4d2c-9e1d-6711b1b61d55';
 message.conversationId=CONVERSATION;
 networkAuth={userId:'staff',can:r=>Boolean(r.conversation)&&r.conversation.every(v=>['read','reply','start'].includes(v))};
 t.mock.method(require('./access'),'loadMessageScope',async()=>({all:false,ticketIds:[],conversationIds:[]}));
 t.mock.method(require('./start'),'recipientOf',async()=>({phone:message.recipientPhone}));
 known=[canonical];job.result={chatId:canonical.externalChatId,nextPart:1,externalIds:['accepted']};
 assert.equal((await inspectPhoneJob(job,channel)).reason,undefined);
 job.result.chatId='unrelated';
 assert.match((await inspectPhoneJob(job,channel)).reason,/недоступен/);
 job.result.chatId=canonical.externalChatId;
 known.push({...canonical,_id:'other-chat',externalChatId:'foreign-chat'});
 assert.match((await inspectPhoneJob(job,channel)).reason,/недоступен/);
});

test('automatic first-contact binding does not attach unresolved backlog',async()=>{
 const job=await send();
 await attachFirstContact(job,channel,{chatId:'remote-peer'});
 assert.equal(bindingCalls[0].attachPending,false);
});
test('ticket replies preserve waiting for unrelated or unresolved messages',async(t)=>{
 const {clearWaitingForReply}=require('./outbound');
 const since=new Date(Date.now()-10000),sentAt=new Date();
 const chat={...canonical,awaitingSince:since};
 foreignWaiting=true;
 const model=require('@/models/message');
 const filters=[];
 t.mock.method(model,'exists',async filter=>{filters.push(filter);return foreignWaiting ? {_id:'foreign'} : null;});
 await clearWaitingForReply({conversation:chat,ticket,sentAt});
 assert.deepEqual(filters[0].ticketId,{$ne:ticket._id});
 assert.deepEqual(filters[0].sentAt,{$gte:since});
 assert.equal(conversationWrites.length,0);
 foreignWaiting=false;
 await clearWaitingForReply({conversation:chat,ticket,sentAt});
 assert.equal(conversationWrites.length,1);
 assert.equal(conversationWrites[0].change.$set.awaitingSince,null);
 assert.equal(conversationWrites[0].filter.awaitingSince,since);
});

test('first-contact reply preserves other pending tickets and own free start never handles the chat',async()=>{
 const job=await send(); canonical.awaitingSince=new Date(Date.now()-10000);foreignWaiting=true;
 await attachFirstContact(job,channel,{chatId:'remote-peer'});
 assert.equal(conversationWrites.some(write=>write.change.$set?.awaitingSince===null),false);
 message.ticketId=null;message.commentId=null;foreignWaiting=false;conversationWrites=[];
 await attachFirstContact(job,channel,{chatId:'remote-peer'});
 assert.equal(conversationWrites.some(write=>write.change.$set?.awaitingSince===null),false);
});
test('personal free sends keep their owner and never clear waiting for a different discussion',async(t)=>{
 const {queueOutbound,clearWaitingForReply}=require('./outbound');
 canonical.awaitingSince=new Date(Date.now()-10000);foreignWaiting=true;
 const filters=[];
 t.mock.method(require('@/models/message'),'exists',async filter=>{filters.push(filter);return {_id:'foreign'};});
 await queueOutbound({conversation:canonical,channel,text:'Новый вопрос',attachments:[],author:{_id:'staff'},prefs:{},withoutTicket:true});
 assert.equal(message.attachMode,'free');assert.equal(message.discussionUserId,'staff');assert.equal(message.ticketId,null);
 assert.equal(conversationWrites.some(write=>write.change.$set?.awaitingSince===null),false);
 assert.ok(filters.some(filter=>filter.$or?.some(clause=>clause.discussionUserId?.$ne==='staff')));
 await clearWaitingForReply({conversation:canonical,discussionUserId:'staff',sentAt:new Date()});
});
test('a new owned first contact can reuse a recipient chat created while queued without inheriting its context',async(t)=>{
 const job=await send();message.ticketId=null;message.commentId=null;
 message.attachMode='free';message.discussionUserId='staff';message.clientRequestId='2dd2b92e-94f4-4d2c-9e1d-6711b1b61d55';
 networkAuth={userId:'staff',can:r=>Boolean(r.conversation)&&r.conversation.every(v=>['read','reply','start'].includes(v))};
 t.mock.method(require('./access'),'loadMessageScope',async()=>({all:false,ticketIds:[],conversationIds:[]}));
 t.mock.method(require('./start'),'recipientOf',async()=>({phone:message.recipientPhone}));
 known=[canonical];
 assert.equal((await inspectPhoneJob(job,channel)).reason,undefined);
 known=[{...canonical,hidden:true}];assert.match((await inspectPhoneJob(job,channel)).reason,/скрыт/);
});
test('existing-chat start is reauthorized by the worker before a real provider send',async(t)=>{
 const {queueOutbound}=require('./outbound');
 const send=async()=>{
  message=null;jobs=[];
  return queueOutbound({conversation:canonical,channel,text:'Новый вопрос',attachments:[],author:{_id:'staff'},prefs:{},recipient:{phone:'79145550142',userId:'client'},clientRequestId:'2dd2b92e-94f4-4d2c-9e1d-6711b1b61d55',withoutTicket:true,discussionUserId:'staff'});
 };
 const acks=[],sends=[];
 t.mock.method(require('@/models/wazzupSettings'),'updateOne',async()=>{});
 t.mock.method(require('./jobs'),'leaseJobs',async()=>({leaseId:'lease',jobs:[jobs[0]]}));
 t.mock.method(require('./jobs'),'ackJobs',async(_lease,items)=>acks.push(...items));
 t.mock.method(require('../wazzup/provider'),'sendMessage',async(_key,body)=>{sends.push(body);return {messageId:'accepted',chatId:canonical.externalChatId};});
 t.mock.method(require('../crypto/secretBox'),'decryptSecret',()=> 'test-key');
 delete require.cache[require.resolve('../wazzup/worker')];
 const {sendOutbox}=require('../wazzup/worker');
 t.mock.method(require('@/models/message'),'findById',()=>query(message));
 t.mock.method(require('./start'),'recipientOf',async()=>({phone:recipient.phone}));
 const settings={isActive:true,apiKey:'encrypted',channelIds:['remote']};
 await send();networkAuth={...auth,can:()=>false};await sendOutbox(settings);
 assert.equal(sends.length,0);assert.match(acks.at(-1).error,/прав/);
 await send();networkAuth=auth;canonical.hidden=true;await sendOutbox(settings);
 assert.equal(sends.length,0);assert.match(acks.at(-1).error,/скрыт/);delete canonical.hidden;
 await send();recipient.banned=true;await sendOutbox(settings);
 assert.equal(sends.length,0);assert.match(acks.at(-1).error,/отключён/);delete recipient.banned;
 await send();recipient.phone='79990000000';await sendOutbox(settings);
 assert.equal(sends.length,0);assert.match(acks.at(-1).error,/Номер получателя изменился/);
 await send();recipient.phone='79145550142';await sendOutbox(settings);
 assert.equal(sends.length,1);assert.equal(sends[0].chatId,canonical.externalChatId);assert.equal(sends[0].phone,undefined);
});

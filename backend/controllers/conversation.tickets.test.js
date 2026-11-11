require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const stub = (path, exports) => {
  const id = require.resolve(path), entry = new Module(id);
  Object.assign(entry, { loaded: true, exports });
  require.cache[id] = entry;
};
const id = n => n.toString(16).padStart(24, '0');
const query = value => ({
  select() { return this; },
  sort() { return this; },
  limit(n) { value = value.slice(0, n); return this; },
  lean: async () => value,
});
const company = id(100), userId = id(101);
const tickets = Array.from({ length: 12 }, (_, index) => ({
  _id: id(index + 1), num: index + 1, title: `Ticket ${index + 1}`,
  isClosed: false, company: { _id: company }, responsibles: [],
}));
// Newest six tickets are already linked. The last ticket is outside the scope.
tickets[11].company = { _id: id(102) };
const conversation = {
  _id: id(103), kind: 'direct', network: 'telegram', companyId: company,
  ticketBindings: tickets.slice(0, 6).map(ticket => ({ ticketId: ticket._id, ticketNum: ticket.num })),
};
stub('@/models/ticket', { Ticket: { find: filter => query(tickets.filter(sift(filter))), findOne: filter => query(tickets.find(sift(filter))) } });
stub('@/models/conversation', { findById: () => query(conversation), find: () => query([]) });
stub('@/models/message', { aggregate: async () => [], countDocuments: async () => 0, find: () => query([{_id:id(300),direction:'in'}]) });
stub('@/models/channelIdentity', { find: () => query([]) });
stub('@/models/conversationRead', { find: () => query([]), findOne: () => query(null) });
stub('@/models/channel', { findById: () => query(null) });
stub('@/models/user', { find: () => query([]), findById: () => query({_id:userId}) });
let mappedTarget;
stub('@/services/messaging/remap', { remapMessages: async ({ticket}) => {mappedTarget=ticket; return 0;} });
stub('@/models/company', { find: () => query([]) });
const { get, mappingTickets, attach, bind } = require('./conversation');

test('card offers five unlinked company tickets even when the newest six are already linked', async () => {
  let body;
  await get({
    params: { id: conversation._id },
    auth: { userId, isAdmin: true, can: () => true },
  }, {
    status() { return this; }, json(value) { body = value; },
  }, error => { throw error; });
  assert.deepEqual(body.openTickets.map(ticket => ticket.num), [7, 8, 9, 10, 11]);
  assert.equal(body.tickets.length, 6);
});

const choose = async (q = '', auth = { userId, isAdmin: true, can: () => true }) => {
 let body;
 await mappingTickets({params:{id:conversation._id},query:{q},auth}, {
 status(){return this;},json(value){body=value;},
 }, error=>{throw error;});
 return body.items;
};
test('mapping search includes closed company tickets by number and title, excluding deleted and other companies', async () => {
 tickets.push({_id:id(200),num:500,title:'Old printer',isClosed:true,company:{_id:company}},
 {_id:id(201),num:501,title:'Old printer',isClosed:true,deletedAt:new Date(),company:{_id:company}},
 {_id:id(202),num:502,title:'Old printer',isClosed:true,company:{_id:id(102)}});
 assert.deepEqual((await choose('#500')).map(t=>t.num),[500]);
 assert.deepEqual((await choose('Old printer')).map(t=>t.num),[500]);
 assert.equal((await choose('#500'))[0].canReply,false);
});
test('mapping search applies ticket access even for a manager who reads every conversation', async () => {
 const auth={userId,isAdmin:false,can:permission=>Boolean(permission.conversation)};
 assert.deepEqual(await choose('Old printer',auth),[]);
});

test('attach accepts an accessible closed target while active binding still rejects it', async () => {
 const target={_id:id(400),num:600,title:'Historical',isClosed:true,company:{_id:company}};
 tickets.push(target);
 const req={params:{id:conversation._id},body:{ticketNum:600,messageIds:[id(300)]},auth:{userId,isAdmin:true,can:()=>true}};
 const res={status(){return this;},json(){}};
 await attach(req,res,error=>{throw error;});
 assert.equal(mappedTarget.num,600);
 assert.equal(mappedTarget.isClosed,true);
 await assert.rejects(bind(req,res,error=>{throw error;}),/Заявка закрыта/);
});

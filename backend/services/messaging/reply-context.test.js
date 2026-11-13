require('module-alias/register');
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const stub=(path,exports)=>{const id=require.resolve(path);const entry=new Module(id);Object.assign(entry,{loaded:true,exports});require.cache[id]=entry;};
const query=value=>({select(){return this;},lean:async()=>value});
let saved, tickets;
stub('@/models/ticket',{Ticket:{find:()=>query(tickets)}});
stub('@/models/conversationRead',{findOne:({userId})=>query(saved[userId] ? {replyContext:saved[userId]} : null),updateOne:async({userId},update)=>{saved[userId]=update.$set.replyContext;}});
stub('@/models/conversation',{findById:()=>query(conversation)});
stub('@/models/preferences',{findOne:()=>query({messaging:{replyContextTimeoutMinutes:30}})});
stub('./access',{canReplyToTicket:(t,a)=>a.allowed.includes(t._id),readsAll:a=>a.full !== false,canReplyWithoutTicket:(c,a)=>a.full !== false || (c.kind==='direct' && a.start === true)});
const {loadReplyContext,chooseReplyContext,resolveReplyTicket}=require('./reply-context');
const conversation={_id:'chat',kind:'direct',ticketBindings:[{ticketId:'a'},{ticketId:'b'}]};
const auth={userId:'staff',allowed:['a','b']};
beforeEach(()=>{saved={};tickets=[{_id:'a',num:1},{_id:'b',num:2}];});
test('each staff member owns a separate reply context and explicit free choice',async()=>{
  await chooseReplyContext({conversation,auth,ticketNum:2});
  assert.equal((await loadReplyContext({conversation,auth})).ticketId,'b');
  assert.equal((await loadReplyContext({conversation,auth:{...auth,userId:'other'}})).required,true);
  await chooseReplyContext({conversation,auth,ticketNum:null});
  assert.equal((await loadReplyContext({conversation,auth})).withoutTicket,true);
});
test('ambiguous, unlinked, inaccessible and stale outgoing targets are rejected',async()=>{
  await assert.rejects(resolveReplyTicket({conversation,auth}),/Выберите/);
  await assert.rejects(resolveReplyTicket({conversation,auth,ticketNum:9}),/недоступна/);
  await assert.rejects(resolveReplyTicket({conversation,auth:{...auth,allowed:['a']},ticketNum:2}),/недоступна/);
  await chooseReplyContext({conversation,auth,ticketNum:1});
  tickets=tickets.filter(t=>t._id!=='a');
  await assert.rejects(resolveReplyTicket({conversation,auth}),/Выберите/);
  await assert.rejects(resolveReplyTicket({conversation,auth,ticketNum:1}),/недоступна/);
  assert.equal(await resolveReplyTicket({conversation,auth,withoutTicket:true}),null);
});

test('group replies stay free without an expiring whole-chat ticket context',async()=>{
 const group={...conversation,kind:'group'};
 saved.staff={ticketId:null,withoutTicket:true,expiresAt:new Date(0)};
 assert.deepEqual(await loadReplyContext({conversation:group,auth}),{ticketId:null,withoutTicket:true,expiresAt:null,required:false});
 assert.deepEqual(await chooseReplyContext({conversation:group,auth,ticketNum:null}),{ticketId:null,withoutTicket:true,expiresAt:null,required:false});
 assert.equal(saved.staff.expiresAt.getTime(),0);
 await assert.rejects(chooseReplyContext({conversation:group,auth,ticketNum:1}),/не привязывается/);
});

test('restricted sender cannot select or reuse a free context',async()=>{
 const limited={...auth,full:false};
 await assert.rejects(chooseReplyContext({conversation,auth:limited,ticketNum:null}),/прав/);
 saved.staff={withoutTicket:true,expiresAt:new Date(Date.now()+60000)};
 await assert.rejects(resolveReplyTicket({conversation,auth:limited}),/прав/);
 await assert.rejects(resolveReplyTicket({conversation:{...conversation,kind:'group'},auth:limited}),/прав/);
});
test('a restricted starter can select a personal free context without taking any ticket context',async()=>{
 const starter={...auth,full:false,start:true,allowed:[]};
 assert.equal((await chooseReplyContext({conversation,auth:starter,ticketNum:null})).withoutTicket,true);
 assert.equal(await resolveReplyTicket({conversation,auth:starter,withoutTicket:true}),null);
 await assert.rejects(resolveReplyTicket({conversation,auth:starter,ticketNum:1}),/недоступна/);
 await assert.rejects(resolveReplyTicket({conversation:{...conversation,kind:'group'},auth:starter,withoutTicket:true}),/прав/);
});

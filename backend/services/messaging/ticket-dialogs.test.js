require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const id = n => n.toString(16).padStart(24, '0');
const own = id(1), foreign = id(2), current = id(10), other = id(11), historic = id(12), hidden = id(13), stranger = id(14);
const tickets = [{ _id: own, responsibles: [{ _id: id(100) }] }, { _id: foreign }];
const chats = [
  { _id: current, ticketBindings: [{ticketId:own}], network:'telegram' },
  { _id: other, ticketBindings: [{ticketId:own}], network:'whatsapp',kind:'direct',counterpartIdentityId:id(50) },
  { _id: historic, ticketBindings: [], network:'telegram',kind:'group',title:'Рабочая группа' },
  { _id: hidden, hidden:true,ticketBindings:[{ticketId:own}],network:'telegram' },
  { _id: stranger, ticketBindings:[{ticketId:foreign}],network:'telegram' },
];
const messages = [{ticketId:own,conversationId:historic},{ticketId:own,conversationId:other},{ticketId:foreign,conversationId:stranger}];
const stub = (path, exports) => { const key=require.resolve(path); const entry=new Module(key);Object.assign(entry,{loaded:true,exports});require.cache[key]=entry; };
const query = value => ({ select(){return this;},lean:async()=>value });
stub('@/models/message',{aggregate:async pipeline=>messages.filter(sift(pipeline[0].$match)).map(row=>({_id:row}))});
stub('@/models/conversation',{find:filter=>query(chats.filter(sift(filter)))});
stub('@/models/channelIdentity',{find:()=>query([{_id:id(50),userId:id(60),displayName:'Nickname'}])});
stub('@/models/user',{find:()=>query([{_id:id(60),firstName:'Антон',lastName:'Швецов'}])});
const {ticketDialogs}=require('./ticket-dialogs');
const auth={userId:id(100),can:requirement=>requirement.conversation.includes('read'),messagingScope:{ticketIds:[own],conversationIds:[historic]}};
test('ticket links include mapped history and active bindings once, excluding current, hidden and foreign dialogs',async()=>{
 const result=await ticketDialogs({tickets,currentId:current,auth});
 assert.equal(result.has(foreign),false);
 assert.deepEqual(result.get(own).map(row=>row.id).sort(),[other,historic]);
 assert.equal(result.get(own).find(row=>row.id===other).title,'Швецов Антон');
 assert.equal(result.get(own).find(row=>row.id===historic).title,'Рабочая группа');
});
test('full conversation reader sees other ticket dialogs without gaining ticket permissions',async()=>{
 const result=await ticketDialogs({tickets,currentId:current,auth:{...auth,can:()=>true}});
 assert.deepEqual(result.get(foreign).map(row=>row.id),[stranger]);
});
test('no readable ticket produces no navigation',async()=>{
 assert.equal((await ticketDialogs({tickets,currentId:current,auth:{userId:id(200),can:()=>false}})).size,0);
});

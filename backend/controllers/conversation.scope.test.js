require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const stub = (path, exports) => { const id = require.resolve(path); const entry = new Module(id); Object.assign(entry, {loaded:true,exports}); require.cache[id] = entry; };
const id = n => n.toString(16).padStart(24,'0');
const matches = filter => sift(JSON.parse(JSON.stringify(filter)));
const query = value => ({ select(){return this;}, sort(){return this;}, limit(n){if(Array.isArray(value))value=value.slice(0,n);return this;}, lean:async()=>value });
const userId=id(1), own=id(2), foreign=id(3), former=id(4), chat=id(5);
const tickets=[{_id:own,responsibles:[{_id:userId}]},{_id:former,messagingReaderIds:[userId],isClosed:true},{_id:foreign,createdBy:userId}];
const rows=[
  {_id:id(10),conversationId:chat,ticketId:own,text:'own',sentAt:'2026-11-12T00:00:00.000Z',updatedAt:'2026-11-12T00:00:00.000Z',seq:1,replyToId:id(11)},
  {_id:id(11),conversationId:chat,ticketId:foreign,text:'secret',sentAt:'2026-11-12T00:00:00.000Z',updatedAt:'2026-11-12T00:00:00.000Z',seq:2,attachments:[{name:'secret.pdf'}]},
  {_id:id(12),conversationId:chat,ticketId:null,text:'unresolved',sentAt:'2026-11-12T00:00:00.000Z',updatedAt:'2026-11-12T00:00:00.000Z',seq:3},
  {_id:id(13),conversationId:chat,ticketId:former,text:'archive',sentAt:'2026-11-12T00:00:00.000Z',updatedAt:'2026-11-12T00:00:00.000Z',seq:4},
  {_id:id(14),conversationId:chat,ticketId:foreign,previousTicketIds:[own],text:'moved secret',sentAt:'2026-11-12T00:00:00.000Z',updatedAt:'2026-11-12T00:00:00.000Z',seq:5},
];
stub('@/models/ticket',{Ticket:{find:filter=>query(tickets.filter(matches(filter)))}});
stub('@/models/message',{find:filter=>query(rows.filter(matches(filter))),distinct:async(field,filter)=>[...new Set(rows.filter(matches(filter)).map(row=>row[field]))]});
stub('@/models/conversation',{findById:()=>query({_id:chat,kind:'direct',ticketBindings:[{ticketId:own}]})});
for(const path of ['channelIdentity','user'])stub(`@/models/${path}`,{find:()=>query([])});
const {messages}=require('./conversation');
const auth = rights => ({userId,can:request=>Object.entries(request).every(([r,actions])=>actions.every(a=>rights.includes(`${r}.${a}`)))});
const get = async (rights,params={}) => {let body; await messages({params:{id:chat},query:params,auth:auth(rights)}, {status(){return this;},json(value){body=value;}},error=>{throw error;});return body;};
test('mixed chat returns only own and former ticket messages, without foreign quote or media',async()=>{
  const body=await get(['conversation.read','ticket.readAll']);
  assert.deepEqual(body.items.map(row=>row.text).sort(),['archive','own']);
  assert.equal(body.items.find(row=>row.text==='own').replyTo,null);
  assert.equal(JSON.stringify(body).includes('secret'),false);
});
test('readAll without own-read and without ticket permissions returns whole chat',async()=>{
  const body=await get(['conversation.readAll']);
  assert.equal(body.items.length,5);
});
test('incremental updates remove remapped messages without revealing their new content',async()=>{
  const body=await get(['conversation.read'],{changedSince:'2026-11-11T00:00:00.000Z'});
  assert.deepEqual(body.removedIds,[id(14)]);
  assert.equal(JSON.stringify(body).includes('secret'),false);
});
test('personal free history, paging and changes never reveal another discussion or ticket',async()=>{
 const at='2026-11-12T00:00:00.000Z';
 const mine={_id:id(15),conversationId:chat,ticketId:null,attachMode:'free',discussionUserId:userId,text:'personal',sentAt:at,updatedAt:at,seq:6,replyToId:id(16)};
 const other={...mine,_id:id(16),discussionUserId:foreign,text:'other private',seq:7};
 const moved={...mine,_id:id(17),ticketId:foreign,attachMode:'manual',text:'new ticket secret',seq:8};
 rows.push(mine,other,moved);
 try {
  const rights=['conversation.read','conversation.reply','conversation.start'];
  const first=await get(rights);
  assert.equal(first.items.find(row=>row.text==='personal').replyTo,null);
  const before=await get(rights,{before:at,beforeSeq:7});
  assert.ok(before.items.some(row=>row.text==='personal'));
  assert.equal(JSON.stringify(before).includes('secret'),false);
  assert.equal(JSON.stringify(before).includes('other private'),false);
  const changes=await get(rights,{changedSince:'2026-11-11T00:00:00.000Z'});
  assert.ok(changes.items.some(row=>row.text==='personal'));
  assert.ok(changes.removedIds.includes(id(17)));
  assert.equal(JSON.stringify(changes).includes('secret'),false);
  assert.equal(JSON.stringify(changes).includes('other private'),false);
 } finally {rows.splice(-3);}
});

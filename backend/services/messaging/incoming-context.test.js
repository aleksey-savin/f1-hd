require('module-alias/register');
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const sift=require('sift').default;
const stub=(path,exports)=>{const id=require.resolve(path),entry=new Module(id);Object.assign(entry,{loaded:true,exports});require.cache[id]=entry;};
let rows,current;
const q=values=>({select(){return this;},sort(){values.sort((a,b)=>new Date(b.sentAt)-new Date(a.sentAt)||b.seq-a.seq);return this;},lean:async()=>values[0]||null});
stub('@/models/message',{
 findOne:filter=>q(rows.filter(sift(filter))),
 updateOne:async(filter,update)=>{if(!sift(filter)(current))return {matchedCount:0};Object.assign(current,update.$set);return {matchedCount:1};},
});
stub('@/models/preferences',{findOne:()=>q([{messaging:{replyContextTimeoutMinutes:30}}])});
const {incomingRoutingContext,persistFreeMapping,findQuotedSource}=require('./incoming-context');
const {decideAttach}=require('./rules');
const conversation={_id:'chat',kind:'direct',ticketBindings:[{ticketId:'A'}]};
const ticket={_id:'A',num:1};
const at=mins=>new Date(Date.UTC(2026,10,11,10,mins));
const message={_id:'incoming',conversationId:'chat',sentAt:at(10),seq:3,direction:'in',origin:'client'};
const free={_id:'free',conversationId:'chat',sentAt:at(5),seq:1,direction:'out',origin:'hd',status:'sent',ticketId:null,attachMode:'free'};
const decide=async(m=message)=>decideAttach({conversation,message:m,linkedTickets:[ticket],...await incomingRoutingContext({conversation,message:m})});
beforeEach(()=>{rows=[{...free}];current={_id:'incoming',ticketId:null,attachMode:null};});
test('a sent free exchange keeps subsequent unquoted messages free despite a sole linked ticket',async()=>{
 assert.equal((await decide()).mode,'free');
});
test('an explicit free quote outranks singleton routing; a ticket quote outranks a recent free exchange',async()=>{
 const quoted={...message,replyToId:'free'};
 assert.equal((await decide(quoted)).mode,'free');
 const context=await incomingRoutingContext({conversation,message});
 assert.equal(decideAttach({conversation,message,linkedTickets:[ticket],...context,replyToMessage:{ticketId:'A'},replyToTicket:ticket}).ticketId,'A');
});
test('the latest ticketed exchange supersedes an older free message; unresolved concurrent arrivals do not hide evidence',async()=>{
 rows.push({...message,_id:'earlier-pending',sentAt:at(6),seq:2});
 assert.equal((await decide()).mode,'free');
 rows.push({...free,_id:'ticketed',ticketId:'A',attachMode:'deliver',sentAt:at(7),seq:2});
 assert.equal((await decide()).ticketId,'A');
});
test('expired, unsent, failed, deleted and imported free anchors do not route a later client message',async()=>{
 for(const patch of [{sentAt:at(-30)},{status:'queued'},{status:'failed'},{deletedAt:at(6)},{imported:true}]){
  rows=[{...free,...patch}];assert.equal((await decide()).ticketId,'A');
  if(patch.status||patch.deletedAt||patch.imported)assert.equal((await decide({...message,replyToId:'free'})).ticketId,'A');
 }
 rows=[];assert.equal((await decide()).ticketId,'A');
});
test('explicit incoming free mapping is evidence; later messages and other conversations are excluded',async()=>{
 rows=[{...free,direction:'in',origin:'client',status:'received'}];assert.equal((await decide()).mode,'free');
 rows=[{...free,sentAt:at(11)},{...free,conversationId:'foreign'}];assert.equal((await decide()).ticketId,'A');
});
test('free routing persists intent without overriding a newer manual ticket choice or remap intent',async()=>{
 await persistFreeMapping(current._id);assert.equal(current.attachMode,'free');
 current={_id:'incoming',ticketId:'A',attachMode:'manual'};await persistFreeMapping(current._id);assert.equal(current.ticketId,'A');
 current={_id:'incoming',ticketId:null,attachMode:null,mappingIntent:{ticketId:'A'}};await persistFreeMapping(current._id);assert.equal(current.attachMode,null);
 current={_id:'incoming',ticketId:null,attachMode:'free'};await persistFreeMapping(current._id);assert.equal(current.attachMode,'free');
});

test('a real free quote remains authoritative after a later attachment failed; unquoted failed sends are not anchors',async()=>{
 rows=[{...free,status:'failed',externalIds:['accepted-text-part']}];
 assert.equal((await decide()).ticketId,'A');
 assert.equal((await decide({...message,replyToId:'free'})).mode,'free');
});


test('a provider quote resolves accepted multipart ids only in its own channel and chat',async()=>{
 rows=[{...free,channelId:'channel',externalChatId:'peer',externalId:'first',externalIds:['first','second']}];
 assert.equal((await findQuotedSource({channelId:'channel',externalChatId:'peer',externalId:'second'}))._id,'free');
 assert.equal(await findQuotedSource({channelId:'channel',externalChatId:'other',externalId:'second'}),null);
});

require('module-alias/register');
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const sift=require('sift').default;
const stub=(path,exports)=>{const id=require.resolve(path),entry=new Module(id);Object.assign(entry,{loaded:true,exports});require.cache[id]=entry;};
const q=value=>({select(){return this;},lean:async()=>value});
let message,comment,tickets,failPull,links,failLink;
const set=(object,path,value)=>{const parts=path.split('.');let row=object;for(const key of parts.slice(0,-1))row=row[key]||={};row[parts.at(-1)]=value;};
const update=(object,change)=>{for(const [path,value]of Object.entries(change.$set||{}))set(object,path,value);for(const key of Object.keys(change.$unset||{}))delete object[key];};
stub('@/models/message',{
 findById:()=>q({...message}),
 findOneAndUpdate:(filter,change)=>{if(!sift(filter)(message))return q(null);update(message,change);return q({...message});},
 updateOne:async(filter,change)=>{if(!sift(filter)(message))return {matchedCount:0};update(message,change);return {matchedCount:1};},
});
stub('@/models/comment',{findOne:()=>q(comment),updateOne:async(filter,change)=>update(comment,change)});
stub('@/models/ticket',{Ticket:{findById:id=>q({_id:id,num:id==='b'?2:1}),updateOne:async(filter,change)=>{
 if(change.$pull&&failPull){failPull=false;throw Error('temporary failure');}
 const ticket=tickets[filter._id];if(!ticket)return;
 if(change.$pull)ticket.comments=ticket.comments.filter(id=>id!==change.$pull.comments);
 if(change.$addToSet&&!ticket.comments.includes(change.$addToSet.comments))ticket.comments.push(change.$addToSet.comments);
}}});
stub('@/models/channelIdentity',{findById:()=>q(null)});
stub('@/models/channel',{findById:()=>q({})});
stub('@/models/preferences',{findOne:()=>q({})});
stub('./bindings',{bindConversation:async args=>{if(failLink){failLink=false;throw Error("link failure");}links.push(args);}});
stub('./conversationStore',{userTalksHere:async()=>false});
const {remapMessages}=require('./remap');
const conversation={_id:'chat',network:'telegram'};
beforeEach(()=>{message={_id:'msg',ticketId:'a',ticketNum:1,commentId:'comment',direction:'out',origin:'hd',text:'original',retryIntent:{payload:{text:'wire\n\n1'}},attachMode:'deliver'};comment={_id:'comment',ticketId:'a',attachments:[{name:'copied-file'}]};tickets={a:{comments:['comment']},b:{comments:[]}};failPull=false;links=[];failLink=false;});
test('moving a message reuses its single mirror, removes old chronicle membership and preserves wire text',async()=>{
 await remapMessages({conversation,messages:[message],ticket:{_id:'b',num:2}});
 assert.equal(message.ticketId,'b');assert.equal(comment.ticketId,'b');
 assert.deepEqual(tickets.a.comments,[]);assert.deepEqual(tickets.b.comments,['comment']);
 assert.deepEqual(comment.attachments,[{name:'copied-file'}]);assert.equal(message.retryIntent.payload.text,'wire\n\n1');
 await remapMessages({conversation,messages:[message],ticket:{_id:'b',num:2}});
 assert.deepEqual(tickets.b.comments,['comment']);
});
test('deliberate free removes mirror from the chronicle and distinguishes unresolved from free',async()=>{
 await remapMessages({conversation,messages:[message],ticket:null});
 assert.equal(message.ticketId,null);assert.equal(message.attachMode,'free');
 assert.equal(comment.ticketId,null);assert.deepEqual(tickets.a.comments,[]);
});
test('partial mirror move retains a durable intent and retry converges',async()=>{
 failPull=true;
 await assert.rejects(remapMessages({conversation,messages:[message],ticket:{_id:'b',num:2}}),/temporary/);
 assert.ok(message.mappingIntent);assert.equal(message.ticketId,'b');
 await remapMessages({conversation,messages:[message],ticket:{_id:'b',num:2}});
 assert.deepEqual(tickets.a.comments,[]);assert.deepEqual(tickets.b.comments,['comment']);assert.equal(message.mappingIntent,undefined);
});
test('an overlapping mapper cannot steal a held mirror lease',async()=>{
 message.mappingLock={token:'other',until:new Date(Date.now()+60_000)};
 await assert.rejects(remapMessages({conversation,messages:[message],ticket:{_id:'b',num:2}}),/обрабатывается/);
 assert.equal(message.ticketId,'a');
});


test('attaching to a new direct ticket adds that link without sweeping unresolved messages; groups stay unbound',async()=>{
 await remapMessages({conversation:{...conversation,kind:'direct'},messages:[message],ticket:{_id:'b',num:2}});
 assert.equal(links.length,1);assert.equal(links[0].ticket._id,'b');assert.equal(links[0].attachPending,false);
 links=[];
 await remapMessages({conversation:{...conversation,kind:'group'},messages:[message],ticket:{_id:'b',num:2}});
 assert.equal(links.length,0);
});


test('a direct target-link failure keeps the move intent so recovery can finish linking',async()=>{
 failLink=true;
 const direct={...conversation,kind:'direct'};
 await assert.rejects(remapMessages({conversation:direct,messages:[message],ticket:{_id:'b',num:2}}),/link failure/);
 assert.ok(message.mappingIntent);
 await remapMessages({conversation:direct,messages:[message],ticket:{_id:'b',num:2}});
 assert.equal(message.mappingIntent,undefined);assert.equal(links.at(-1).ticket._id,'b');
 assert.deepEqual(tickets.a.comments,[]);assert.deepEqual(tickets.b.comments,['comment']);
});

test('remapping retains previous ticket IDs for removal from restricted live threads',async()=>{
 await remapMessages({conversation,messages:[message],ticket:{_id:'b',num:2}});
 assert.deepEqual(message.previousTicketIds,['a']);
 await remapMessages({conversation,messages:[message],ticket:null});
 assert.deepEqual(message.previousTicketIds,['a','b']);
});

require('module-alias/register');
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const sift=require('sift').default;
const stub=(path,exports)=>{const id=require.resolve(path),entry=new Module(id);Object.assign(entry,{loaded:true,exports});require.cache[id]=entry;};
const q=value=>({lean:async()=>value});
let message,copied;
const update=(change)=>{Object.assign(message,change.$set||{});for(const key of Object.keys(change.$unset||{}))delete message[key];};
stub('@/models/message',{
 updateMany:async(filter,change)=>{if(sift(filter)(message))update(change);},
 findOneAndUpdate:(filter,change)=>{if(!sift(filter)(message))return q(null);update(change);return q({...message});},
 updateOne:async(filter,change)=>{if(!sift(filter)(message))return {matchedCount:0};update(change);return {matchedCount:1};},
});
stub('@/models/conversation',{updateOne:async()=>{}});
stub('@/models/ticket',{Ticket:{updateOne:async()=>{}}});
stub('@/services/storage',{copyObject:async()=>{copied++;return 'copy';}});
stub('@/services/pulse',{bus:{bump(){}}});
stub('./conversationStore',{addSystemLine:async()=>{}});
const {applyOrigin}=require('./origin');
const snapshot={_id:'message',ticketId:null,attachMode:null,attachments:[{status:'ready',name:'file'}]};
const origin={conversation:{_id:'chat',kind:'group'},messages:[snapshot]};
const ticket={_id:'new',num:42};
beforeEach(()=>{message={...snapshot};copied=0;});
test('ticket creation does not overwrite a newer deliberate free mapping',async()=>{
 message.attachMode='free';
 await applyOrigin({ticket,origin});
 assert.equal(message.ticketId,null);assert.equal(message.attachMode,'free');assert.equal(copied,0);
});
test('ticket creation respects an in-progress remap lease and leaves its durable intent intact',async()=>{
 message.mappingLock={token:'mapper',until:new Date(Date.now()+60_000)};
 message.mappingIntent={ticketId:null};
 await applyOrigin({ticket,origin});
 assert.equal(message.ticketId,null);assert.deepEqual(message.mappingIntent,{ticketId:null});assert.equal(copied,0);
});
test('unchanged selected origin is claimed once and repeat never duplicates attachment copies',async()=>{
 await applyOrigin({ticket,origin});await applyOrigin({ticket,origin});
 assert.equal(message.ticketId,'new');assert.equal(message.attachMode,'origin');assert.equal(copied,1);
});

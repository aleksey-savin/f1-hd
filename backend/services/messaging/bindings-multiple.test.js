require('module-alias/register');
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const sift=require('sift').default;
const stub=(path,exports)=>{const id=require.resolve(path),entry=new Module(id);Object.assign(entry,{loaded:true,exports});require.cache[id]=entry;};
const q=value=>({sort(){return this;},select(){return this;},lean:async()=>value});
let live,lines,pending,failMirror;
const setPath=(object,path,value)=>{const keys=path.split('.');let target=object;for(const key of keys.slice(0,-1))target=target[key]||={};target[keys.at(-1)]=value;};
stub('@/models/conversation',{
 findById:()=>q(structuredClone(live)),
 find:filter=>q(sift(filter)(live)?[structuredClone(live)]:[]),
 updateOne:async(filter,update,options={})=>{
  if(!sift(filter)(live))return {matchedCount:0,modifiedCount:0};
  const selectedLinks=options.arrayFilters ? (live.ticketBindings||[]).filter(sift(Object.fromEntries(Object.entries(options.arrayFilters[0]).map(([key,value])=>[key.replace('link.',''),value])))) : [];
  for(const [path,value] of Object.entries(update.$set||{})){
   if(path.includes('$[link]')){
    for(const link of selectedLinks)setPath(link,path.split('$[link].')[1],value);
   }else setPath(live,path,structuredClone(value));
  }
  for(const [path,value]of Object.entries(update.$push||{}))live[path].push(value);
  return {matchedCount:1,modifiedCount:1};
 },
});
stub('@/models/ticket',{Ticket:{find:filter=>q((filter._id?.$in||[]).map(id=>({_id:id}))),findById:id=>q({_id:id,num:2,isClosed:false})}});
stub('@/models/message',{
 find:filter=>q(pending.filter(sift(filter))),
 findOneAndUpdate:(filter,change)=>{const message=pending.find(sift(filter));if(message)Object.assign(message,change.$set);return q(message ? {...message} : null);},
 findById:id=>q(pending.find(message=>message._id===id)),
});
stub('@/models/preferences',{findOne:()=>q({})});
stub('@/models/channel',{findById:()=>q({})});
stub('./mirror',{mirrorToTicket:async({message})=>{
 if(failMirror){failMirror=false;throw Error('temporary mirror failure');}
 pending.find(item=>item._id===message._id).commentId='mirror';
}});
stub('@/services/ticketAccess',{canAccessTicket:(ticket,auth)=>auth.allowed.includes(ticket._id)});
stub('@/services/pulse',{bus:{bump(){}}});
stub('./conversationStore',{addSystemLine:async(c,event)=>lines.push(event),userTalksHere:async()=>false});
const {bindConversation,unbindConversation,endBindingsForTicket,restoreBindingsAfterReopen}=require('./bindings');
const {activeBindings}=require('./multi-ticket');
beforeEach(()=>{live={_id:'chat',binding:{ticketId:'old',ticketNum:1,endedAt:null}};lines=[];pending=[];failMirror=false;});
test('retry completes a partially mirrored binding without duplicating links or events',async()=>{
 live={_id:'chat',kind:'direct',binding:{},awaitingSince:new Date('2026-11-12T01:00:00Z')};
 pending=[{_id:'message',conversationId:'chat',ticketId:null,attachMode:null,direction:'in',origin:'client',sentAt:new Date('2026-11-12T01:00:01Z')}];
 failMirror=true;
 const bind=()=>bindConversation({conversation:structuredClone(live),ticket:{_id:'new',num:2}});
 await assert.rejects(bind(),/temporary mirror failure/);
 assert.equal(pending[0].commentId,undefined);
 await bind();
 assert.equal(pending[0].commentId,'mirror');
 assert.equal(activeBindings(live).length,1);
 assert.equal(lines.length,1);
});
test('adding concurrent links migrates the old binding once and retains each selected ticket',async()=>{
 const snapshot=structuredClone(live);
 await Promise.all(['two','three'].map((id,i)=>bindConversation({conversation:snapshot,ticket:{_id:id,num:i+2},attachPending:false})));
 assert.deepEqual(activeBindings(live).map(link=>link.ticketId),['old','two','three']);
 await bindConversation({conversation:structuredClone(live),ticket:{_id:'two',num:2},attachPending:false});
 assert.equal(activeBindings(live).length,3);
});
test('unlinking one ticket preserves the other link and does not alter messages',async()=>{
 await bindConversation({conversation:structuredClone(live),ticket:{_id:'two',num:2},attachPending:false});
 await unbindConversation({conversation:structuredClone(live),ticketNum:2});
 assert.deepEqual(activeBindings(live).map(link=>link.ticketId),['old']);
 assert.equal(live.ticketBindings[1].endReason,'manual');
});
test('ticket closure terminates only its link and retains the other active ticket',async()=>{
 await bindConversation({conversation:structuredClone(live),ticket:{_id:'two',num:2},attachPending:false});
 await endBindingsForTicket('two','closed');
 assert.deepEqual(activeBindings(live).map(link=>link.ticketId),['old']);
 assert.equal(live.ticketBindings[1].endReason,'closed');
});
test('first-contact cannot claim a migrated conversation occupied by a different live link',async()=>{
 live.binding.endedAt=new Date();live.ticketBindings=[{ticketId:'other',ticketNum:8,endedAt:null}];
 assert.equal(await bindConversation({conversation:{_id:'chat'},ticket:{_id:'new',num:9},onlyIfUnbound:true,attachPending:false}),false);
 assert.equal(live.ticketBindings[0].ticketId,'other');
});


test('reopening a secondary canonical ticket restores its waiting decision without replacing another live link',async()=>{
 await bindConversation({conversation:structuredClone(live),ticket:{_id:'two',num:2},attachPending:false});
 await endBindingsForTicket('two','closed');
 live.decision={ticketId:'two',ticketNum:2};
 await restoreBindingsAfterReopen('two');
 assert.deepEqual(activeBindings(live).map(link=>link.ticketId),['old','two']);
 assert.equal(live.decision.ticketId,null);
});


test('unlink rejects out-of-scope linked tickets, including legacy unlink-all, before changing any links',async()=>{
 await bindConversation({conversation:structuredClone(live),ticket:{_id:'two',num:2},attachPending:false});
 const auth={userId:'staff',allowed:['old']};
 await assert.rejects(unbindConversation({conversation:structuredClone(live),ticketNum:2,auth}),/не найдена/);
 await assert.rejects(unbindConversation({conversation:structuredClone(live),auth}),/не найдена/);
 assert.deepEqual(activeBindings(live).map(link=>link.ticketId),['old','two']);
 await unbindConversation({conversation:structuredClone(live),ticketNum:1,auth});
 assert.deepEqual(activeBindings(live).map(link=>link.ticketId),['two']);
});

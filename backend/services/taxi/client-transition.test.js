require('module-alias/register');
const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');const sift=require('sift').default;
const clone=v=>structuredClone(v);const query=v=>({select(){return this},lean:async()=>clone(v)});
const stub=(path,exports)=>{const filename=require.resolve(path);const entry=new Module(filename);Object.assign(entry,{filename,loaded:true,exports});require.cache[filename]=entry};
const at=time=>new Date(`2026-11-10T${time}:00Z`);
let user,trips,events;
const read=id=>trips.get(String(id));
stub('../../models/taxi',{TaxiSettings:{},TaxiEmployee:{},TaxiTrip:{
 findById:id=>query(read(id)),
 findOneAndUpdate:(filter,update)=>{const trip=read(filter._id);if(!trip||!sift(filter)(trip))return query(null);Object.assign(trip,clone(update.$set));return query(trip)},
 updateOne:async(filter,update)=>{const trip=read(filter._id);if(trip&&sift(filter)(trip)){Object.assign(trip,clone(update.$set));return {matchedCount:1}}return {matchedCount:0}},
}});
stub('../../models/user',{findById:()=>query(user),updateOne:async(filter,update)=>{if(!sift(filter)(user))return {matchedCount:0};user.workStatus=clone(update.$set.workStatus);return {matchedCount:1}}});
stub('../../models/company',{findById:id=>query({alias:id==='company-a'?'УК 71':'Автогарант'})});
stub('../../models/preferences',{findOne:()=>query({notify:{byTelegram:{isActive:true,sendToGroup:true,chatId:'group'}}})});
stub('../../models/notification',{updateOne:async(filter,update)=>{if(!events.has(String(filter._id)))events.set(String(filter._id),clone(update.$setOnInsert))}});
const {createStore}=require('./sync');
const setup=()=>{
 user={_id:'user',firstName:'Василий',lastName:'Юшин',isEndUser:false,workStatus:{code:'office',source:'manual',updatedAt:at('01:00')}};
 const trip=(id,companyId,address)=>({_id:id,userId:'user',purpose:'business',status:'transporting',companyId,destination:{address},presenceAppliedAt:null,announcementClaimedAt:null});
 trips=new Map([['a',trip('a','company-a','Россия, Приморский край, Владивосток, улица Нейбута, 33А')],['b',trip('b','company-b','Россия, Приморский край, Владивосток, Шилкинская улица, 32а')]]);events=new Map();return createStore({clientId:'corp'},'lease');
};
test('a separate ride from one client to another updates the company and emits one new compact departure',async()=>{
 const store=setup();await store.live(clone(read('a')),at('02:29'));await store.live(clone(read('b')),at('02:35'));await store.live(clone(read('b')),at('02:36'));
 assert.equal(user.workStatus.code,'trip');assert.equal(user.workStatus.taxiTripId,'b');assert.equal(user.workStatus.note,'Автогарант · Владивосток, Шилкинская улица, 32а');
 assert.equal(events.size,2);assert.match(events.get('b').text,/компания Автогарант/);assert.doesNotMatch(events.get('b').text,/Россия|Приморский край/);
});
test('recovery of an older departure cannot announce the old client after a newer client trip',async()=>{
 const store=setup();await store.live(clone(read('a')),at('02:29'));await store.live(clone(read('b')),at('02:35'));read('a').announcementClaimedAt=null;events.delete('a');
 await store.live(clone(read('a')),at('02:36'));
 assert.equal(user.workStatus.taxiTripId,'b');assert.equal(events.has('a'),false);assert.ok(read('a').announcementClaimedAt);
});
test('a later manual status suppresses a delayed pending departure as well as the status update',async()=>{
 const store=setup();read('b').presenceAppliedAt=at('02:35');user.workStatus={code:'lunch',source:'manual',updatedAt:at('02:36')};await store.live(clone(read('b')),at('02:37'));
 assert.equal(user.workStatus.code,'lunch');assert.equal(events.size,0);assert.ok(read('b').announcementClaimedAt);
});

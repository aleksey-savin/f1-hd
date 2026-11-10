const {test}=require('node:test');const assert=require('node:assert/strict');
const {createTaxiNotifications}=require('./notifications');
const now=new Date('2026-11-10T05:00:00Z');
const user={firstName:'Василий',lastName:'Юшин'};
const trip={_id:'64f1a2b3c4d5e6f708192a3b',presenceAppliedAt:new Date('2026-11-10T04:59:00Z'),finishedAt:new Date('2026-11-10T04:59:00Z'),destination:{address:'Россия, Приморский край, Владивосток, улица Нейбута, 33А, Управляющая компания 71-го микрорайона'}};
const setup=(group={isActive:true,sendToGroup:true,chatId:'group',messageThreadId:'topic'})=>{
 const events=new Map();let failAfterInsert=false;
 const queue=createTaxiNotifications({Preferences:{findOne:()=>({select(){return this},lean:async()=>({notify:{byTelegram:group}})})},Notification:{updateOne:async(filter,change)=>{if(!events.has(String(filter._id)))events.set(String(filter._id),change.$setOnInsert);if(failAfterInsert){failAfterInsert=false;throw new Error('response lost')}}}});
 return {queue,events,fail:()=>{failAfterInsert=true}};
};
test('departure and office arrival use different stable event keys and compact escaped text',async()=>{
 const {queue,events}=setup();
 await queue.departure(trip,user,'УК 71',now);await queue.departure(trip,user,'УК 71',now);
 await queue.officeArrival(trip,user,now);await queue.officeArrival(trip,user,now);
 assert.equal(events.size,2);
 assert.ok(events.has(trip._id));
 const departure=events.get(trip._id);assert.doesNotMatch(departure.text,/Россия|Приморский край/);assert.match(departure.text,/Владивосток, улица Нейбута, 33А/);
 const arrival=[...events.entries()].find(([id])=>id!==trip._id);assert.match(arrival[0],/^[a-f0-9]{24}$/);assert.equal(arrival[1].text,'🏢 Василий Юшин снова в офисе');assert.deepEqual(arrival[1].to,{chatId:'group',globalChat:true,messageThreadId:'topic'});
});
test('old history, future timestamps and disabled Telegram do not enqueue misleading notices',async()=>{
 for(const group of [{isActive:false,sendToGroup:true,chatId:'group'},{isActive:true,sendToGroup:false,chatId:'group'},{isActive:true,sendToGroup:true}]){const {queue,events}=setup(group);await queue.officeArrival(trip,user,now);assert.equal(events.size,0)}
 for(const finishedAt of [new Date('2026-11-09T04:59:00Z'),new Date('2026-11-10T05:01:00Z'),undefined]){const {queue,events}=setup();await queue.officeArrival({...trip,finishedAt},user,now);assert.equal(events.size,0)}
});
test('an outbox write with a lost response retries the same office event without duplication',async()=>{
 const {queue,events,fail}=setup();fail();await assert.rejects(queue.officeArrival(trip,user,now),/response lost/);await queue.officeArrival(trip,user,now);assert.equal(events.size,1);
});
test('names and customer addresses cannot inject Telegram HTML',async()=>{
 const {queue,events}=setup();await queue.departure({...trip,destination:{address:'Россия, Приморский край, Владивосток, <улица>, 3'}},{firstName:'<Василий>',lastName:'Юшин & Ко'},'Клиент & партнёры',now);
 const text=events.get(trip._id).text;assert.doesNotMatch(text,/<Василий>|<улица>/);assert.match(text,/&lt;Василий&gt;/);assert.match(text,/Клиент &amp; партнёры/);
});

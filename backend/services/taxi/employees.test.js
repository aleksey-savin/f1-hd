require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const stub = (path, exports) => { const filename = require.resolve(path); const item = new Module(filename); Object.assign(item, { filename, loaded: true, exports }); require.cache[filename] = item; };
const writes=[];
stub('../../models/taxi', { TaxiSettings:{updateOne:async()=>({matchedCount:1})},TaxiEmployee:{updateOne:async(filter,update)=>{writes.push({filter,update});}},TaxiTrip:{} });
stub('../../models/user',{});stub('../../models/company',{});stub('../../models/subdivision',{});stub('../../models/work',{});stub('../../models/ticket',{Ticket:{}});stub('../../models/preferences',{});stub('../../models/notification',{});
const {createStore}=require('./sync');
test('employee sync preserves the documented full name, email and nickname without changing a manual HD mapping',async()=>{
  await createStore({clientId:'corp',token:'cipher'},'lease').saveEmployees([{id:'external',fullname:' Максим Гурьянов ',email:' maxim@example.org ',nickname:'maxim',phone:'+79140000000',is_active:true,is_deleted:false}]);
  assert.equal(writes[0].update.$set.fullName,'Максим Гурьянов');
  assert.equal(writes[0].update.$set.email,'maxim@example.org');
  assert.equal(writes[0].update.$set.nickname,'maxim');
  assert.equal(Object.hasOwn(writes[0].update.$set,'userId'),false);
});
test('inactive and deleted employees are not marked active',async()=>{
  await createStore({clientId:'corp',token:'cipher'},'lease').saveEmployees([{id:'disabled',is_active:false},{id:'deleted',is_active:true,is_deleted:true}]);
  assert.equal(writes[1].update.$set.active,false);assert.equal(writes[2].update.$set.active,false);
});

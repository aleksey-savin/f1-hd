require('module-alias/register');
const { test, beforeEach }=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const sift=require('sift').default;
const id=require.resolve('@/models/message'),entry=new Module(id);
let message;
Object.assign(entry,{loaded:true,exports:{
 findOneAndUpdate:(_filter,update)=>{Object.assign(message,update.$set);return {lean:async()=>({...message})};},
 updateOne:async(filter,update)=>{
  if(!sift(filter)(message))return {matchedCount:0};
  if(update.$set?.['mappingLock.until'])message.mappingLock.until=update.$set['mappingLock.until'];
  if(update.$unset?.mappingLock)delete message.mappingLock;
  return {matchedCount:1};
 },
}});require.cache[id]=entry;
const {withMessageLease}=require('./message-lease');
beforeEach(()=>{message={_id:'message'};});
test('mirror work can renew and verify its ownership before persisting after an await',async()=>{
 await withMessageLease('message',async(_message,lease)=>{
  assert.equal(typeof lease?.assertOwned,'function');
  message.mappingLock.until=new Date(Date.now()+1000);
  await lease.assertOwned();
  assert.ok(message.mappingLock.until.getTime()>Date.now()+60_000);
 });
 assert.equal(message.mappingLock,undefined);
});
test('a resumed old worker cannot persist or unlock a replacement mapper lease',async()=>{
 await assert.rejects(withMessageLease('message',async(_message,lease)=>{
  assert.equal(typeof lease?.assertOwned,'function');
  message.mappingLock={token:'replacement',until:new Date(Date.now()+60_000)};
  await lease.assertOwned();
 }),/обрабатывается/);
 assert.equal(message.mappingLock.token,'replacement');
});
test('expired ownership cannot be revived by a paused worker',async()=>{
 await assert.rejects(withMessageLease('message',async(_message,lease)=>{
  assert.equal(typeof lease?.assertOwned,'function');
  message.mappingLock.until=new Date(0);
  await lease.assertOwned();
 }),/обрабатывается/);
});

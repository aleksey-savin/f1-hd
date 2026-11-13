require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const stub = (path, exports) => { const id = require.resolve(path); require.cache[id] = Object.assign(new Module(id), { loaded: true, exports }); };
const users = [{_id:'owner',read:true},{_id:'global',readAll:true,manage:true},{_id:'other',read:true}];
stub('@/models/user', {find:filter=>({select(){return this;},lean:async()=>users.filter(sift(filter))})});
stub('@/services/permissions', {permissionFilter:async action=>({[action.split('.')[1]]:true})});
const { recipientsFor } = require('./notify');
test('free reply notifications include their owner without notifying other restricted readers', async () => {
 const recipients=await recipientsFor({_id:'chat'},{ticketId:null,attachMode:'free',discussionUserId:'owner'});
 assert.deepEqual(recipients.map(u=>u._id).sort(),['global','owner']);
 assert.deepEqual((await recipientsFor({_id:'chat'},{ticketId:'foreign',attachMode:'manual',discussionUserId:'owner'})).map(u=>u._id),['global']);
 users[0].read=false;
 try {assert.deepEqual((await recipientsFor({_id:'chat'},{ticketId:null,attachMode:'free',discussionUserId:'owner'})).map(u=>u._id),['global']);}
 finally {users[0].read=true;}
});

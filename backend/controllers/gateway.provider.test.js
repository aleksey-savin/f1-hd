require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
for (const [path, exports] of [['../models/ticket', { Ticket: {} }], ['../utils/logger', { log() {}, info() {}, warn() {}, error() {} }]]) {
  const filename = require.resolve(path), entry = new Module(filename);
  Object.assign(entry, { filename, loaded: true, exports }); require.cache[filename] = entry;
}
const Channel = require('../models/channel');
const ChannelJob = require('../models/channelJob');
const gateway = require('./gateway');
const { ackJobs } = require('../services/messaging/jobs');
const sift = require('sift').default;
const id = '64f600000000000000000001';
const invoke = async (handler, body) => {
  let result, error;
  await handler({ body, query: {} }, { status() { return this; }, json(value) { result = value; } }, value => { error = value; });
  assert.equal(error, undefined);
  return result;
};
test('direct gateway cannot inject events or heartbeat for Wazzup-owned channels', async t => {
  const remote = { _id: id, provider: 'wazzup' };
  t.mock.method(Channel, 'exists', async filter => sift(filter)(remote));
  const result = await invoke(gateway.events, { events: [{ type: 'channel.state', channelId: id, state: 'connected' }] });
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].retryable, false);
  t.mock.method(Channel, 'updateMany', async filter => { assert.equal(sift(filter)(remote), false); });
  assert.deepEqual(await invoke(gateway.heartbeat, { channels: [{ id }] }), { ok: true });
});
test('knowing a Wazzup job id and lease does not authorize gateway acknowledgement', async t => {
  const job = { _id: id, provider: 'wazzup', leaseId: 'lease' };
  t.mock.method(ChannelJob, 'findOne', async filter => { assert.equal(sift(filter)(job), false); return null; });
  assert.deepEqual(await ackJobs('lease', [{ id, ok: true }]), { applied: 0, ignored: 1 });
});
test('direct gateway rechecks queued existing-chat starts before exposing a send job', async t => {
  const queue = require('../services/messaging/jobs');
  const starts = require('../services/messaging/start');
  const jobs=[{_id:id,type:'send',channelId:id,payload:{startRequest:true,chatId:'peer',text:'private'}},{_id:'other',type:'testProxy',channelId:id,payload:{}}];
  const acks=[];
  t.mock.method(queue,'leaseJobs',async()=>({leaseId:'lease',jobs}));
  t.mock.method(queue,'ackJobs',async(lease,items)=>{assert.equal(lease,'lease');acks.push(...items);});
  const inspect=t.mock.method(starts,'inspectStartJob',async()=>({reason:'Недостаточно прав для отправки'}));
  delete require.cache[require.resolve('./gateway')];
  const fresh = require('./gateway');
  const blocked = await invoke(fresh.jobs);
  assert.deepEqual(blocked.jobs.map(job=>job.id),['other']);
  assert.equal(acks[0].retryable,false);assert.equal(acks[0].ok,false);assert.equal(acks[0].id,id);
  inspect.mock.mockImplementation(async()=>({conversation:{_id:'chat'}}));
  assert.equal((await invoke(fresh.jobs)).jobs.length,2);
});

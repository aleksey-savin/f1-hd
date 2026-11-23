import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredRefresh } from './deferred-refresh.ts';
const flush = () => new Promise(setImmediate);

test('queued refresh waits through both busy fetchers and a later editor pause', async () => {
  let calls = 0;
  const queue = createDeferredRefresh(async () => { calls++; return true; });
  const first = queue.request();
  queue.setReady(false);
  await flush();
  assert.equal(calls, 0);
  queue.setReady(true);
  assert.equal(await first, true);
  assert.equal(calls, 1);
});

test('failed refresh resolves false and a later request retries', async () => {
  let calls = 0;
  const queue = createDeferredRefresh(async () => { if (++calls === 1) throw Error('offline'); return true; });
  queue.setReady(true);
  assert.equal(await queue.request(), false);
  assert.equal(await queue.request(), true);
});

test('unmount releases queued and running requests without falsely acknowledging data', async () => {
  let finish;
  const queue = createDeferredRefresh(() => new Promise(resolve => { finish = resolve; }));
  queue.setReady(true);
  const running = queue.request(), queued = queue.request();
  queue.dispose();
  assert.equal(await running, false);
  assert.equal(await queued, false);
  finish(true);
  await flush();
  assert.equal(await queue.request(), false);
});

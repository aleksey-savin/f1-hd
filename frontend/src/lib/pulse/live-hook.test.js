import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createLiveConsumer, parseCursor } from './live-cursor.ts';

function moduleWith(file, bindings) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm, '');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, console, setTimeout, clearTimeout, ...bindings });
  return exports;
}
const flush = () => new Promise(setImmediate);
const snapshot = rev => ({ epoch: 'e', rev, topics: { tickets: rev }, tickets: {} });

test('live hook pauses hidden updates and shared cadence, then applies pending change on return', async () => {
  const document = new EventTarget();
  document.visibilityState = 'hidden';
  const effects = [], listeners = new Set(), cadences = new Set();
  const state = { snapshot: snapshot(4), requestCadence(ms) { const token = { ms }; cadences.add(token); return () => cadences.delete(token); } };
  let sessionChanged;
  const store = { getState: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  const useLiveTopic = moduleWith('../../hooks/use-live-topic.ts', {
    useEffect: fn => effects.push(fn), useRef: value => ({ current: value }), createLiveConsumer, parseCursor,
    usePulseStore: store, document, onBrowserSessionChange: fn => { sessionChanged = fn; return () => {}; },
  }).default;
  let calls = 0;
  useLiveTopic('tickets', async () => { calls++; }, { baseline: 'e:4', cadenceMs: 3000 });
  const cleanups = effects.map(fn => fn());
  const emit = rev => { const prev = { ...state }; state.snapshot = snapshot(rev); for (const listener of listeners) listener(state, prev); };
  emit(5);
  await flush();
  assert.equal(calls, 0);
  assert.equal(cadences.size, 0);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  assert.equal(calls, 1);
  assert.equal(cadences.size, 1);
  sessionChanged();
  emit(5);
  await flush();
  assert.equal(calls, 2, 'a new session cannot inherit a fresh baseline');
  cleanups.forEach(cleanup => cleanup?.());
  emit(6);
  assert.equal(calls, 2);
  assert.equal(cadences.size, 0);
});

test('a queued pulse does not start after the tab becomes hidden', async () => {
  const document = new EventTarget();
  document.visibilityState = 'visible';
  let calls = 0, resolve;
  const { createPollingTransport } = moduleWith('./transport.ts', { document });
  const transport = createPollingTransport({ request: () => { calls++; return new Promise(done => { resolve = done; }); }, delay: () => 10000 });
  transport.start();
  transport.poke();
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  resolve();
  await flush();
  assert.equal(calls, 1);
  transport.stop();
});

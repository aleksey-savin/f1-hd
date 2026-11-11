require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const express = require('express');
const { attachmentUrl, createMediaHandler } = require('./outgoing-media');

test('provider downloads S3 attachments through HD without redirects, preserving bytes and filename', async t => {
  const bytes = Buffer.from('# Test config, no keys\n[Interface]\n');
  const app = express();
  app.get('/uploads/direct/:name/:filename', createMediaHandler({
    openObject: async name => {
      assert.equal(name, 'cp-storage-key.conf');
      return { body: Readable.from([bytes]), contentLength: bytes.length, contentType: 'application/octet-stream' };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const previousUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = `http://127.0.0.1:${server.address().port}/ignored?secret=unused#hash`;
  t.after(() => { if (previousUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = previousUrl; });
  const url = attachmentUrl({ name: 'cp-storage-key.conf', originalName: 'wireguard test.conf' });
  assert.equal(new URL(url).search, '');
  assert.equal(new URL(url).hash, '');
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(url, { method, redirect: 'manual' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.match(response.headers.get('content-disposition'), /wireguard test\.conf/);
    assert.match(response.headers.get('content-security-policy'), /sandbox/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === 'GET' ? bytes : Buffer.alloc(0));
  }
});

test('missing media and unsafe keys cannot expose storage errors or escape the upload namespace', async t => {
  const app = express();
  let reads = 0;
  app.get('/uploads/direct/:name/:filename', createMediaHandler({ openObject: async () => { reads++; throw Error('secret storage endpoint'); } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const missing = await fetch(`${base}/uploads/direct/missing.conf/test.conf`);
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /secret/);
  const unsafe = await fetch(`${base}/uploads/direct/..%2Fprivate/test.conf`);
  assert.equal(unsafe.status, 400);
  assert.equal(reads, 1);
});

require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const express = require('express');
const { attachmentUrl, createMediaHandler } = require('./outgoing-media');
const { createMediaAccess } = require('../messaging/media-access');

test('provider downloads S3 attachments through HD without redirects, preserving bytes and filename', async t => {
  const bytes = Buffer.from('# Test config, no keys\n[Interface]\n');
  const app = express();
  app.get('/uploads/direct/:name/:filename', createMediaAccess({
    direct: true, findMessages: async () => [{ ticketId: null }], ticketAccess: () => false,
    attachSession: (_req, _res, next) => next(),
  }), createMediaHandler({
    openObject: async name => {
      assert.equal(name, 'cp-storage-key.conf');
      return { body: Readable.from([bytes]), contentLength: bytes.length, contentType: 'application/octet-stream' };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = 'test-provider-media-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = previousSecret; });
  const previousUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = `http://127.0.0.1:${server.address().port}/ignored?secret=unused#hash`;
  t.after(() => { if (previousUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = previousUrl; });
  const url = attachmentUrl({ name: 'cp-storage-key.conf', originalName: 'wireguard test.conf' });
  assert.ok(new URL(url).searchParams.get('token'));
  assert.ok(new URL(url).searchParams.get('expires'));
  assert.equal(new URL(url).hash, '');
  const unsigned = new URL(url); unsigned.search = '';
  assert.equal((await fetch(unsigned)).status, 404);
  const forged = new URL(url); forged.searchParams.set('token', '0'.repeat(64));
  assert.equal((await fetch(forged)).status, 404);
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

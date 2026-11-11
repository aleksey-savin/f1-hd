const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validationResult } = require('express-validator');
const { add } = require('./comment');
const Comment = require('../models/comment');

const id = '64f600000000000000000001';
test('comment accepts an uploaded attachment without text at HTTP and model boundaries', async () => {
  const req = { body: { ticketId: id, content: '' }, files: [{ key: 'photo.png', mimetype: 'image/png' }] };
  for (const rule of add) await rule.run(req);
  assert.deepEqual(validationResult(req).array(), []);
  const comment = new Comment({ ticketId: id, createdBy: id, updatedBy: id, content: '', attachments: [{ name: 'photo.png', mimetype: 'image/png' }] });
  await comment.validate();
});

test('empty comments and body-only attachment claims remain invalid', async () => {
  for (const content of ['', '   ']) {
    const req = { body: { ticketId: id, content, attachments: ['pretend.png'] }, files: [] };
    for (const rule of add) await rule.run(req);
    assert.ok(validationResult(req).array().some(error => error.path === 'content'));
    const comment = new Comment({ ticketId: id, createdBy: id, updatedBy: id, content });
    await assert.rejects(comment.validate(), error => Boolean(error.errors.content));
  }
});

require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeTicket } = require('./detector');
const departure = (name, quote, extra = {}) => ({ name, employment: 'departure', access: 'closeAll', quote, effectiveDate: null, systems: [], exceptions: [], ...extra });

test('unsupported AI evidence is a normal empty result, not a retryable failure', async () => {
  const ticket = { description: 'Сидоров Илья уволен.' };
  for (const candidate of [
    departure('Петров Иван', ticket.description),
    departure('Сидоров Илья', 'Выдуманная цитата'),
    departure('Сидоров Илья', ticket.description, { email: 'invented@example.org' }),
  ]) {
    const result = await analyzeTicket({ ticket, generateJson: async () => ({ events: [candidate] }) });
    assert.equal(result.method, 'ai');
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.matches, []);
  }
});

test('unsupported AI evidence does not discard other confirmed subjects', async () => {
  const ticket = { description: 'Сидоров Илья уволен. Орлов Иван вернулся.', company: { _id: 'a' } };
  const result = await analyzeTicket({ ticket, generateJson: async () => ({ events: [
    departure('Петров Иван', 'Сидоров Илья уволен.'),
    departure('Сидоров Илья', 'Сидоров Илья уволен.'),
    departure('Орлов Иван', 'Орлов Иван вернулся.', { employment: 'return', access: 'preserve' }),
  ] }) });
  assert.deepEqual(result.events.map(({ name, employment }) => [name, employment]), [
    ['Сидоров Илья', 'departure'], ['Орлов Иван', 'return'],
  ]);
});

// These are synthetic adaptations of corpus patterns, not production content.
test('comment-only dismissals survive the prefilter and all four subjects are matched independently', async () => {
  const names = ['Крылов Иван', 'Соколов Пётр', 'Уткин Андрей', 'Гусев Юрий'];
  const comments = names.map((name, index) => ({ content: `${name} уволен, закрыть все доступы.`, createdAt: `2026-04-0${index + 1}` }));
  const users = names.map((name, index) => ({ _id: String(index), lastName: name.split(' ')[0], firstName: name.split(' ')[1], company: { _id: 'a' } }));
  const result = await analyzeTicket({ ticket: { title: 'Создание новых учёток', description: 'Заведите Анну', company: { _id: 'a' } }, comments, users, generateJson: async (prompt) => {
    const data = JSON.parse(prompt.user);
    assert.equal(data.sources.filter((source) => source.sourceId.startsWith('comment:')).length, 4);
    assert.equal(data.users, undefined);
    return { data: { events: names.map((name, index) => departure(name, comments[index].content)) } };
  } });
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.matches.map((item) => item.userId), ['0', '1', '2', '3']);
});

test('remote access alone is not confused with removing an account', async () => {
  const result = await analyzeTicket({ ticket: { description: 'Не работает удалённый доступ к рабочему столу.' }, generateJson: async () => { throw new Error('should skip'); } });
  assert.equal(result.skipped, 'irrelevant');
});

test('return, continued project, scoped restriction, reused mailbox and last working day all reach analysis', async () => {
  for (const description of ['Сидоров Илья вернулся, подготовьте рабочее место.', 'Сидоров Илья уволен, но продолжает проект, доступ сохранить.', 'Сидоров Илья: ограничить доступ только к VPN.', 'Почту Сидоров Илья передать другому сотруднику.', 'Последний рабочий день Сидоров Илья — 25 апреля 2026.']) {
    const result = await analyzeTicket({ ticket: { description }, generateJson: async () => ({ data: { events: [departure('Сидоров Илья', description, { access: 'none', employment: 'unclear' })] } }) });
    assert.equal(result.events.length, 1, description);
    assert.equal(result.matches[0].match, 'unknown');
  }
});

test('the global AI switch prevents calls even when the source is relevant', async () => {
  const result = await analyzeTicket({ ticket: { description: 'Сидоров Илья уволен' }, preferences: { ai: { isActive: false } }, generateJson: async () => { throw new Error('disabled provider called'); } });
  assert.equal(result.skipped, 'ai_disabled');
});

test('provider and malformed output errors propagate so the worker can retry rather than mark success', async () => {
  const ticket = { description: 'Сидоров Илья уволен.' };
  await assert.rejects(analyzeTicket({ ticket, generateJson: async () => { throw new Error('provider offline'); } }), /provider offline/);
  await assert.rejects(analyzeTicket({ ticket, generateJson: async () => ({ data: { events: 'invalid' } }) }), /events/);
});

test('mixed reinstatement and tomorrow departures retain separate actions and dates', async () => {
  const ticket = { createdAt: '2026-04-10T02:00:00Z', description: 'Сегодня Сидоров Илья: восстановить доступ. Завтра Орлов Иван: закрыть все доступы.' };
  const result = await analyzeTicket({ ticket, generateJson: async () => ({ data: { events: [departure('Сидоров Илья', 'Сегодня Сидоров Илья: восстановить доступ.', { employment: 'return', access: 'preserve', effectiveDate: '2026-04-10' }), departure('Орлов Иван', 'Завтра Орлов Иван: закрыть все доступы.', { effectiveDate: '2026-04-11' })] } }) });
  assert.deepEqual(result.events.map((item) => [item.employment, item.access, item.effectiveDate]), [['return', 'preserve', '2026-04-10'], ['departure', 'closeAll', '2026-04-11']]);
});

test('implicit departure and access commands containing the persons name pass the prefilter', async () => {
  for (const description of ['Сидоров Илья больше не работает.', 'Просьба заблокировать Сидоров Илья во всех системах.', 'Восстановите Сидоров Илья доступ в почту.']) {
    const result = await analyzeTicket({ ticket: { description }, generateJson: async () => ({ data: { events: [departure('Сидоров Илья', description)] } }) });
    assert.equal(result.events.length, 1, description);
  }
});

test('local rules reject FineReader, technical replies, generic returned errors and quoted-only history', async () => {
  for (const input of [{ ticket: { description: 'FineReader вернул ошибку лицензии.' }, comments: [{ content: 'Восстановить резервную копию.' }] }, { ticket: { description: 'Сервер вернул ошибку 500' } }, { ticket: { description: '> Сидоров Илья уволен. Закрыть все доступы.', isArchived: true } }]) {
    const result = await analyzeTicket({ ...input, generateJson: async () => { throw new Error('irrelevant source reached provider'); } });
    assert.equal(result.method, 'rules');
    assert.equal(result.skipped, 'irrelevant');
    assert.equal(result.inputChars, 0);
    assert.deepEqual(result.events, []);
  }
});

test('cached selected evidence is regrounded and rematched against current company users without AI', async () => {
  const ticket = { description: 'FineReader', company: { _id: 'a' } };
  const evidence = { _id: 'offboarding', createdAt: '2026-11-01', content: 'Сидоров Илья уволен, закрыть все доступы.' };
  const first = await analyzeTicket({ ticket, comments: [evidence], generateJson: async () => ({ data: { events: [departure('Сидоров Илья', evidence.content)] } }) });
  assert.equal(first.method, 'ai');
  const cached = await analyzeTicket({ ticket, comments: [{ _id: 'tech', content: JSON.stringify({ type: 'diagnostic', code: 0, status: 'ok' }) }, evidence], previous: { inputFingerprint: first.inputFingerprint, events: first.events }, users: [{ _id: 'fresh', firstName: 'Илья', lastName: 'Сидоров', company: { _id: 'a' } }], generateJson: async () => { throw new Error('cache called provider'); } });
  assert.equal(cached.method, 'cache');
  assert.equal(cached.matches[0].userId, 'fresh');
  assert.equal(cached.fingerprint === first.fingerprint, false);
  assert.equal(cached.inputFingerprint, first.inputFingerprint);
});

test('edited evidence invalidates the selected cache and malformed cached events are never trusted', async () => {
  const ticket = { company: { _id: 'a' }, description: 'Сидоров Илья уволен.' };
  const first = await analyzeTicket({ ticket, generateJson: async () => ({ data: { events: [departure('Сидоров Илья', ticket.description)] } }) });
  const edited = { ...ticket, description: 'Сидоров Илья вернулся.' };
  const result = await analyzeTicket({ ticket: edited, previous: first, generateJson: async () => ({ data: { events: [departure('Сидоров Илья', edited.description, { employment: 'return', access: 'preserve' })] } }) });
  assert.equal(result.method, 'ai');
  assert.equal(result.events[0].employment, 'return');
  const malformed = await analyzeTicket({ ticket, previous: { inputFingerprint: first.inputFingerprint, events: [departure('Петров Иван', 'Вымышленное свидетельство')] }, generateJson: async () => ({ data: { events: [] } }) });
  assert.equal(malformed.method, 'ai');
  assert.deepEqual(malformed.events, []);
});

test('regrounding cached scheduled evidence keeps blocking exceptions stable', async () => {
  const ticket = { description: 'Сидоров Илья: закрыть все доступы 15 ноября.' };
  const first = await analyzeTicket({ ticket, generateJson: async () => ({ data: { events: [departure('Сидоров Илья', ticket.description)] } }) });
  const cached = await analyzeTicket({ ticket, previous: first, generateJson: async () => { throw new Error('cache called provider'); } });
  assert.deepEqual(cached.events, first.events);
  assert.equal(cached.method, 'cache');
});

test('a diagnostic JSON label cannot keep a departure cache when it carries human qualification', async () => {
  const ticket = { description: 'Сидоров Илья уволен. Закрыть все доступы.' };
  const first = await analyzeTicket({ ticket, generateJson: async () => ({ data: { events: [departure('Сидоров Илья', ticket.description)] } }) });
  const result = await analyzeTicket({ ticket, previous: first, comments: [{ _id: 'human-json', content: JSON.stringify({ type: 'health', message: 'Пока поживёт с прежними правами' }) }], generateJson: async () => ({ data: { events: [] } }) });
  assert.equal(result.method, 'ai');
  assert.notEqual(result.inputFingerprint, first.inputFingerprint);
  assert.deepEqual(result.events, []);
});

test('AI stage is awaited only before a real provider call, never for local or cached results', async () => {
  const ticket = { description: 'Сидоров Илья уволен. Закрыть все доступы.' };
  const steps = [];
  const first = await analyzeTicket({ ticket, onStage: async (stage) => { await Promise.resolve(); steps.push(stage); },
    generateJson: async () => { steps.push('provider'); return { data: { events: [departure('Сидоров Илья', ticket.description)] } }; },
  });
  assert.deepEqual(steps, ['ai', 'provider']);
  for (const input of [{ ticket, previous: first }, { ticket: { description: 'FineReader вернул ошибку лицензии.' } }]) {
    await analyzeTicket({ ...input, onStage: async () => assert.fail('local result announced an AI call'),
      generateJson: async () => assert.fail('local result called provider') });
  }
  let calls = 0;
  await assert.rejects(analyzeTicket({ ticket,
    onStage: async () => { throw new Error('lease expired'); },
    generateJson: async () => { calls++; return { data: { events: [] } }; },
  }), /lease expired/);
  assert.equal(calls, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings, fingerprintTicket, normalizeAnalysis, matchSubjects, reconcileEvidence, deletionCandidates } = require('./policy');

const user = (id, lastName, firstName, extra = {}) => ({ _id: id, lastName, firstName, company: { _id: 'a', isActive: true }, ...extra });
const event = (name, quote, extra = {}) => ({ name, employment: 'departure', access: 'closeAll', effectiveDate: null, quote, systems: [], exceptions: [], ...extra });

test('settings stay opt-in and reject coercion of booleans and invalid thresholds', () => {
  assert.deepEqual(normalizeSettings(), { enabled: false, suggestDeletion: false, disabledDays: 90, inactivityDays: 180, historyPaused: true });
  assert.deepEqual(normalizeSettings({ enabled: 'true', suggestDeletion: true, disabledDays: -1, inactivityDays: 2.5, historyPaused: false }), { enabled: false, suggestDeletion: true, disabledDays: 90, inactivityDays: 180, historyPaused: false });
});

test('fingerprint changes for comment-only and questionnaire evidence but ignores ticket status and update clocks', () => {
  const ticket = { title: 'Учётки', description: 'Новые сотрудники', createdAt: '2026-04-01', company: { _id: 'a' } };
  const fingerprint = fingerprintTicket(ticket, []);
  assert.equal(fingerprintTicket({ ...ticket, updatedAt: new Date(), status: 'closed', isArchived: true }, []), fingerprint);
  assert.notEqual(fingerprintTicket(ticket, [{ content: 'Сидоров Илья уволен', createdAt: '2026-04-02' }]), fingerprint);
  assert.notEqual(fingerprintTicket({ ...ticket, customFields: [{ name: 'Сотрудник', value: 'Сидоров Илья' }] }, []), fingerprint);
});

test('normalization retains every person in a long request and strips model supplied IDs', () => {
  const names = Array.from({ length: 16 }, (_, i) => `Сотрудников${i} Иван`);
  const description = names.map((name) => `${name} уволен, закрыть все доступы.`).join('\n');
  const result = normalizeAnalysis({ events: names.map((name) => ({ ...event(name, `${name} уволен, закрыть все доступы.`), userId: 'injected', _id: 'injected' })) }, { ticket: { description, createdAt: '2026-04-01' } });
  assert.equal(result.length, 16);
  assert.equal(result[0].userId, undefined);
  assert.equal(result[0]._id, undefined);
});

test('malformed outputs and fabricated quotations or identities fail instead of becoming a checked empty analysis', () => {
  const context = { ticket: { description: 'Сидоров Илья уволен.' } };
  assert.throws(() => normalizeAnalysis({ result: [] }, context), /events/);
  assert.throws(() => normalizeAnalysis({ events: [event('Сидоров Илья', 'Вымышленная цитата')] }, context), /quote/);
  assert.throws(() => normalizeAnalysis({ events: [event('Петров Пётр', 'Сидоров Илья уволен.')] }, context), /identity/);
  assert.throws(() => normalizeAnalysis({ events: [event('Сидоров Илья', 'Сидоров Илья уволен.', { access: 'delete' })] }, context), /access/);
});

test('old quoted letters and signatures cannot become current departure evidence', () => {
  const ticket = { description: 'Подготовить место, Сидоров Илья вернулся.\nС уважением,\nПетров Иван', createdAt: '2026-04-03' };
  const comments = [{ content: 'Принято.', quotedText: 'Сидоров Илья уволен.', createdAt: '2026-04-04' }];
  const result = normalizeAnalysis({ events: [event('Сидоров Илья', 'Сидоров Илья уволен.'), event('Петров Иван', 'Петров Иван')] }, { ticket, comments });
  assert.equal(result[0].employment, 'historical');
  assert.equal(result[0].access, 'none');
  assert.equal(result[1].employment, 'historical');
  assert.equal(result[1].sourceRole, 'signature');
});

test('HTML quotations stay historical while the current request remains current', () => {
  const ticket = { description: '<p>Сидоров Илья уволен.</p><blockquote><p>Петров Иван уволен.</p></blockquote>' };
  const result = normalizeAnalysis({ events: [event('Сидоров Илья', 'Сидоров Илья уволен.'), event('Петров Иван', 'Петров Иван уволен.')] }, { ticket });
  assert.deepEqual(result.map((item) => item.employment), ['departure', 'historical']);
});

test('effective dates must be real days grounded in the same source and relative days use its timestamp', () => {
  const ticket = { description: 'Сегодня Сидоров Илья вернулся, завтра Петров Иван уволен.', createdAt: '2026-04-10T02:00:00Z' };
  const result = normalizeAnalysis({ events: [event('Сидоров Илья', 'Сегодня Сидоров Илья вернулся', { employment: 'return', access: 'preserve', effectiveDate: '2026-04-10' }), event('Петров Иван', 'завтра Петров Иван уволен.', { effectiveDate: '2026-04-11' }), event('Петров Иван', 'завтра Петров Иван уволен.', { effectiveDate: '2026-02-30' })] }, { ticket });
  assert.deepEqual(result.map((item) => item.effectiveDate), ['2026-04-10', '2026-04-11', null]);
});

test('company scoped matches support ё, parentheses, reversed names and initials without guessing near names', () => {
  const users = [user('one', 'Семёнов (Старов)', 'Пётр Сергеевич'), user('other-company', 'Семенов', 'Петр Сергеевич', { company: { _id: 'b' } }), user('near', 'Семинов', 'Петр Сергеевич')];
  const result = matchSubjects([event('Старов П. С.', ''), event('Петр Семенов', ''), event('Семинов Пётр', ''), event('Семонов Петр', '')], users, { companyId: 'a' });
  assert.deepEqual(result.map((item) => item.userId), ['one', 'one', 'near', null]);
});

test('a surname or abbreviated name shared by several people remains ambiguous', () => {
  const users = [user('one', 'Орлов', 'Иван Петрович'), user('two', 'Орлов', 'Игорь Петрович')];
  const result = matchSubjects([event('Орлов', ''), event('Орлов И. П.', ''), event('Орлов Иван', '')], users, { companyId: 'a' });
  assert.deepEqual(result.map((item) => item.match), ['ambiguous', 'ambiguous', 'matched']);
  assert.deepEqual(result[0].candidates, ['one', 'two']);
});

test('unknown identities and conflicting mailbox ownership remain unresolved', () => {
  const users = [user('new-owner', 'Новый', 'Иван', { email: 'shared@example.org' })];
  const result = matchSubjects([event('Прежний Пётр', '', { email: 'shared@example.org' }), event('Неизвестный Пётр', '')], users, { companyId: 'a' });
  assert.equal(result[0].userId, null);
  assert.deepEqual(result[0].candidates, ['new-owner']);
  assert.equal(result[1].match, 'unknown');
});

test('later return, ongoing project, partial restriction and account reuse block full disabling', () => {
  const departure = { ...event('Сидоров Илья', ''), sourceAt: '2026-04-01' };
  for (const later of [event('Сидоров Илья', '', { employment: 'return', access: 'none' }), event('Сидоров Илья', '', { access: 'preserve' }), event('Сидоров Илья', '', { access: 'restrict', systems: ['VPN'] }), event('Сидоров Илья', '', { access: 'handover' })]) {
    const result = reconcileEvidence([departure, { ...later, sourceAt: '2026-04-02' }]);
    assert.equal(result.actionable, false);
    assert.equal(result.blocked, true);
  }
});

test('a later explicit departure supersedes an earlier return, and future closure waits', () => {
  const old = { ...event('Сидоров Илья', '', { employment: 'return', access: 'preserve' }), sourceAt: '2026-04-01' };
  assert.equal(reconcileEvidence([old, { ...event('Сидоров Илья', ''), sourceAt: '2026-04-03' }]).actionable, true);
  assert.equal(reconcileEvidence([{ ...event('Сидоров Илья', '', { effectiveDate: '2999-01-01' }), sourceAt: '2026-04-03' }]).reason, 'scheduled');
});

test('deletion requires opt-in, an active company, a known old disabledAt and a still effective ban', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const old = { banned: true, disabledAt: '2026-01-01', updatedAt: '2025-01-01' };
  const users = [user('eligible', '', '', old), user('unknown', '', '', { banned: true, updatedAt: '2025-01-01' }), user('expired', '', '', { ...old, banExpires: '2026-06-30' }), user('service', '', '', { ...old, isServiceAccount: true }), user('deleted', '', '', { ...old, deletedAt: '2026-01-02' }), user('company-off', '', '', { ...old, company: { _id: 'a', isActive: false } }), user('boundary', '', '', { ...old, disabledAt: '2026-04-02' }), user('active', '', '', { ...old, banned: false })];
  assert.deepEqual(deletionCandidates(users, { suggestDeletion: true, disabledDays: 90 }, now).map((item) => item._id), ['eligible']);
  assert.deepEqual(deletionCandidates(users, { suggestDeletion: false }, now), []);
});

test('relative dates follow the organisation day across UTC midnight and stay bound to their quoted sentence', () => {
  const ticket = { description: 'Сегодня Сидоров Илья вернулся. Завтра Петров Иван уволен.', createdAt: '2026-04-10T20:00:00Z' };
  const result = normalizeAnalysis({ events: [event('Сидоров Илья', 'Сегодня Сидоров Илья вернулся.', { employment: 'return', access: 'preserve', effectiveDate: '2026-04-11' }), event('Сидоров Илья', 'Сегодня Сидоров Илья вернулся.', { effectiveDate: '2026-04-12' }), event('Петров Иван', 'Завтра Петров Иван уволен.', { effectiveDate: '2026-04-12' })] }, { ticket, timezone: 'Asia/Vladivostok' });
  assert.deepEqual(result.map((item) => item.effectiveDate), ['2026-04-11', null, '2026-04-12']);
});

test('a familiar given name without a surname cannot resolve a subject', () => {
  assert.equal(matchSubjects([event('Иван', '')], [user('one', 'Сидоров', 'Иван')], { companyId: 'a' })[0].userId, null);
});
test('telephony identities are not proposed for deletion after inactivity', () => {
  const records = [user('phone', '', '', { banned: true, disabledAt: '2025-01-01', isCloudTelephony: true })];
  assert.deepEqual(deletionCandidates(records, { suggestDeletion: true, disabledDays: 90 }, new Date('2026-11-09')), []);
});
test('quoted-only plain-text history cannot become a current account closure', () => {
  const ticket = { description: '> Сидоров Илья уволен. Отключить все доступы.', createdAt: '2026-11-09' };
  const events = normalizeAnalysis({ events: [event('Сидоров Илья', 'Сидоров Илья уволен. Отключить все доступы.')] }, { ticket });
  assert.equal(events[0].sourceRole, 'quoted');
  assert.equal(reconcileEvidence(events).actionable, false);
});
test('whole quoted messages with mail headers remain historical evidence', () => {
  for (const header of ['On Mon, Nov 1, 2026 at 10:00 AM Sender <sender@example.test> wrote:', 'От: Отправитель\nОтправлено: 1 ноября 2026']) {
    const ticket = { description: `${header}\nСидоров Илья уволен. Отключить все доступы.`, createdAt: '2026-11-09' };
    const events = normalizeAnalysis({ events: [event('Сидоров Илья', 'Сидоров Илья уволен. Отключить все доступы.')] }, { ticket });
    assert.equal(events[0].sourceRole, 'quoted');
    assert.equal(reconcileEvidence(events).actionable, false);
  }
});

test('a name elsewhere in the same letter cannot ground another persons quotation', () => {
  const ticket = { description: 'Сидоров Илья уволен. Петров Иван работает.' };
  assert.throws(() => normalizeAnalysis({ events: [event('Петров Иван', 'Сидоров Илья уволен.')] }, { ticket }), /identity/);
});

test('a full Russian written date grounds an effective day', () => {
  const ticket = { description: 'Последний рабочий день Сидоров Илья — 25 апреля 2026.' };
  const [result] = normalizeAnalysis({ events: [event('Сидоров Илья', ticket.description, { effectiveDate: '2026-04-25' })] }, { ticket });
  assert.equal(result.effectiveDate, '2026-04-25');
});

test('undated counterevidence cannot be silently ordered before a dated departure', () => {
  const result = reconcileEvidence([event('Сидоров Илья', '', { access: 'preserve' }), { ...event('Сидоров Илья', ''), sourceAt: '2026-04-10' }]);
  assert.equal(result.blocked, true);
});

test('repeated current quotations receive the most recent source time', () => {
  const quote = 'Сидоров Илья уволен.';
  const comments = [{ content: quote, createdAt: '2026-04-01' }, { content: quote, createdAt: '2026-04-10' }];
  assert.equal(normalizeAnalysis({ events: [event('Сидоров Илья', quote)] }, { comments })[0].sourceAt, '2026-04-10T00:00:00.000Z');
});

test('scheduled departures become available on the organisation calendar day', () => {
  const result = reconcileEvidence([{ ...event('Сидоров Илья', '', { effectiveDate: '2026-04-11' }), sourceAt: '2026-04-01' }], new Date('2026-04-10T20:00:00Z'), { timezone: 'Asia/Vladivostok' });
  assert.equal(result.actionable, true);
});

test('short numeric year and Russian date without year use the dated source conservatively', () => {
  for (const [description, effectiveDate] of [['Сидоров Илья: закрыть все доступы 31.10.25.', '2025-10-31'], ['Сидоров Илья: закрыть все доступы 15 ноября.', '2026-11-15']]) {
    const [result] = normalizeAnalysis({ events: [event('Сидоров Илья', description, { effectiveDate })] }, { ticket: { description, createdAt: '2026-10-01' } });
    assert.equal(result.effectiveDate, effectiveDate);
  }
});

test('a missing year cannot be invented beyond the source year or without a source timestamp', () => {
  const description = 'Сидоров Илья: закрыть все доступы 15 ноября.';
  for (const ticket of [{ description, createdAt: '2026-10-01' }, { description }]) {
    const [result] = normalizeAnalysis({ events: [event('Сидоров Илья', description, { effectiveDate: '2027-11-15' })] }, { ticket });
    assert.equal(result.effectiveDate, null);
    assert.equal(reconcileEvidence([result]).actionable, false);
  }
});

test('missing or invalid model dates never turn explicitly scheduled closure into an immediate action', () => {
  for (const description of ['Сидоров Илья: закрыть все доступы 15 ноября.', 'Сидоров Илья: закрыть все доступы завтра.', 'Сидоров Илья: закрыть все доступы через два дня.', 'Последний рабочий день Сидоров Илья — 31.10.25.']) {
    for (const effectiveDate of [null, '2026-02-30', '2026-01-01']) {
      const [result] = normalizeAnalysis({ events: [event('Сидоров Илья', description, { effectiveDate })] }, { ticket: { description, createdAt: '2026-10-01' } });
      const decision = reconcileEvidence([result], new Date('2026-10-02'));
      assert.equal(decision.actionable, false, `${description}; model date=${effectiveDate}`);
      assert.equal(decision.blocked, true);
    }
  }
});

test('date grounding cannot borrow another persons written date from the same letter', () => {
  const description = 'Сидоров Илья: закрыть все доступы 15 ноября. Петров Иван: закрыть все доступы 16 ноября.';
  const [result] = normalizeAnalysis({ events: [event('Сидоров Илья', 'Сидоров Илья: закрыть все доступы 15 ноября.', { effectiveDate: '2026-11-16' })] }, { ticket: { description, createdAt: '2026-10-01' } });
  assert.equal(result.effectiveDate, null);
  assert.equal(reconcileEvidence([result]).actionable, false);
});

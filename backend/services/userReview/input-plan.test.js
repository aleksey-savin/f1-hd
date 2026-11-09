require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert/strict');
const { planTicketInput } = require('./input-plan');
const ticket = (description, extra = {}) => ({ description, createdAt: '2026-11-01', company: { _id: 'a' }, ...extra });
const prefs = { ai: { isActive: true, provider: 'openai', openai: { model: 'example-model', apiKey: 'secret' } }, timezone: 'Europe/Moscow' };

test('ordinary technical cases and generic returned errors need no model input', () => {
  for (const description of ['FineReader не запускается, вернул ошибку лицензии.', 'Сервер вернул ошибку 500.', 'Не работает удалённый доступ. Восстановите подключение.', 'Сидоров Илья забыл пароль. Восстановите доступ к почте.', 'Восстановить резервную копию базы сотрудника Сидоров Илья.']) {
    const plan = planTicketInput({ ticket: ticket(description), preferences: prefs });
    assert.equal(plan.relevant, false, description);
    assert.equal(plan.prompt, null);
    assert.equal(plan.inputChars, 0);
  }
});

test('archived quoted letters and signatures alone cannot trigger an AI call', () => {
  for (const description of ['> Сидоров Илья уволен. Закрыть все доступы.', '<blockquote>Сидоров Илья уволен.</blockquote>', 'Принято.\nС уважением,\nСидоров Илья уволен.']) {
    assert.equal(planTicketInput({ ticket: ticket(description, { isArchived: true }), comments: [{ content: 'Программу переустановили.', quotedText: 'Петров Иван уволен.' }] }).relevant, false);
  }
});

test('all comment-only personnel signals survive unrelated title and category', () => {
  const comments = Array.from({ length: 143 }, (_, i) => ({ _id: `c${i}`, content: `Сотрудников${i} Иван уволен, закрыть все доступы.`, createdAt: '2026-11-02' }));
  const plan = planTicketInput({ ticket: ticket('Установить FineReader', { title: 'Ошибка программы', categoryId: 'software' }), comments });
  assert.equal(plan.relevant, true);
  assert.equal(plan.selectedSources.filter((source) => source.sourceId.startsWith('comment:')).length, 143);
});

test('personnel return, partial restriction, mailbox handover and implicit termination remain candidates', () => {
  for (const description of ['Сидоров Илья вернулся, подготовьте рабочее место.', 'Сидоров Илья больше не работает. Закройте все учётные записи.', 'Сидоров Илья: ограничить доступ только к VPN.', 'Почту Сидоров Илья передать другому сотруднику.', 'Последний рабочий день Сидоров Илья — 15 ноября.']) {
    assert.equal(planTicketInput({ ticket: ticket(description) }).relevant, true, description);
  }
});

test('selected context keeps the complete long list, date and remote counterevidence but omits technical history', () => {
  const list = Array.from({ length: 16 }, (_, i) => `Сотрудников${i} Иван`).join('\n');
  const comments = [{ _id: 'departure', content: `Отключить все доступы сотрудникам 15 ноября:\n${list}` }, ...Array.from({ length: 80 }, (_, i) => ({ _id: `technical${i}`, content: JSON.stringify({ type: 'diagnostic', sequence: i, checks: Array.from({ length: 100 }, () => ({ status: 'ok', code: 0 })) }) })), { _id: 'exception', content: 'Но Сотрудников5 Иван продолжает проект, ему доступ оставить.' }, { _id: 'context', content: 'Исключение из списка — Сотрудников6 Иван, он вернулся.' }];
  const plan = planTicketInput({ ticket: ticket('Проверить принтер'), comments });
  const selectedText = JSON.parse(plan.prompt.user).sources.map((source) => source.text).join('\n');
  assert.ok(selectedText.includes(list));
  assert.ok(selectedText.includes('15 ноября'));
  assert.ok(selectedText.includes('продолжает проект'));
  assert.ok(selectedText.includes('он вернулся'));
  assert.ok(!selectedText.includes('"type":"diagnostic"'));
  assert.ok(plan.selectedSourceCount < 8);
  assert.ok(plan.inputChars < 15000);
  assert.equal(plan.inputChars, plan.prompt.system.length + plan.prompt.user.length);
});

test('live references retain necessary quoted context while quoted-only history stays out', () => {
  const plan = planTicketInput({ ticket: ticket('FineReader'), comments: [{ _id: 'live', content: 'Сидоров Илья больше не работает. Выполните просьбу ниже, кроме почты.', quotedText: 'Закрыть все доступы Сидоров Илья после 15 ноября.' }, { _id: 'old', content: 'Программу проверили.', quotedText: 'Петров Иван уволен.' }] });
  const payload = JSON.parse(plan.prompt.user);
  assert.ok(payload.sources.some((source) => source.sourceRole === 'quoted' && source.text.includes('после 15 ноября')));
  assert.ok(!payload.sources.some((source) => source.text.includes('Петров Иван')));
});

test('irrelevant insertions leave selected input hash stable, edits and active model/timezone invalidate it', () => {
  const evidence = { _id: 'evidence', content: 'Сидоров Илья уволен, закрыть все доступы.', createdAt: '2026-11-02' };
  const base = planTicketInput({ ticket: ticket('FineReader'), comments: [evidence], preferences: prefs });
  const unrelated = planTicketInput({ ticket: ticket('FineReader'), comments: [{ _id: 'tech', content: JSON.stringify({ type: 'diagnostic', code: 500, status: 'failed' }) }, evidence], preferences: prefs });
  assert.equal(unrelated.inputFingerprint, base.inputFingerprint);
  assert.notEqual(planTicketInput({ ticket: ticket('FineReader'), comments: [{ ...evidence, content: `${evidence.content} Кроме почты.` }], preferences: prefs }).inputFingerprint, base.inputFingerprint);
  assert.notEqual(planTicketInput({ ticket: ticket('FineReader'), comments: [evidence], preferences: { ...prefs, timezone: 'Asia/Vladivostok' } }).inputFingerprint, base.inputFingerprint);
  assert.notEqual(planTicketInput({ ticket: ticket('FineReader'), comments: [evidence], preferences: { ...prefs, ai: { ...prefs.ai, openai: { model: 'new-model' } } } }).inputFingerprint, base.inputFingerprint);
  assert.equal(planTicketInput({ ticket: ticket('FineReader'), comments: [evidence], preferences: { ...prefs, ai: { ...prefs.ai, openai: { ...prefs.ai.openai, apiKey: 'rotated-key' } } } }).inputFingerprint, base.inputFingerprint);
  assert.ok(!base.prompt.user.includes('secret'));
});

test('unrelated user directory changes do not alter model payload or input hash', () => {
  const source = ticket('Сидоров Илья уволен.');
  const base = planTicketInput({ ticket: source });
  const changed = planTicketInput({ ticket: source, users: [{ _id: 'x', firstName: 'Пётр', lastName: 'Другой', company: { _id: 'a' } }] });
  assert.equal(changed.inputFingerprint, base.inputFingerprint);
  assert.deepEqual(JSON.parse(changed.prompt.user), JSON.parse(base.prompt.user));
});

test('a shared employment heading retains a separate surname list and unnamed access instruction', () => {
  const source = ticket('Сидоров\nПетров\nКрылов', { title: 'Увольнение сотрудников' });
  const plan = planTicketInput({ ticket: source, comments: [{ _id: 'action', content: 'Отключить все доступы 15 ноября.' }, { _id: 'condition', content: 'Только VPN, остальное оставить.' }] });
  const payload = JSON.parse(plan.prompt.user).sources.map((item) => item.text).join('\n');
  assert.ok(payload.includes('Сидоров\nПетров\nКрылов'));
  assert.ok(payload.includes('Отключить все доступы 15 ноября.'));
  assert.ok(payload.includes('Только VPN, остальное оставить.'));
});

test('a current explicit instruction can refer to quoted personnel evidence without quoted-only triggers', () => {
  const plan = planTicketInput({ comments: [{ _id: 'live', content: 'Прошу выполнить просьбу ниже, кроме почты.', quotedText: 'Сидоров Илья уволен, закрыть все доступы.' }] });
  assert.equal(plan.relevant, true);
  assert.equal(plan.selectedSources.length, 2);
  assert.ok(plan.selectedSources.some((source) => source.sourceRole === 'quoted'));
  assert.equal(planTicketInput({ ticket: ticket('> Сидоров Илья уволен.', { title: 'Re: Увольнение' }) }).relevant, false);
});

test('a named reporter does not turn a returning software error into a returning employee', () => {
  for (const description of ['Сидоров Илья сообщил, что вернулась ошибка FineReader.', 'У сотрудника Сидоров Илья программа вернулась к прежним ошибкам.']) {
    assert.equal(planTicketInput({ ticket: ticket(description) }).relevant, false, description);
  }
  assert.equal(planTicketInput({ ticket: ticket('Сидоров Илья вернулся на работу, но ошибка FineReader осталась.') }).relevant, true);
});

test('software which stopped working is not mistaken for an employee who left', () => {
  for (const description of ['FineReader больше не работает, восстановите доступ к лицензии.', 'Программа раньше работала у нас, теперь не запускается.', 'Сервер перестал работать.']) {
    assert.equal(planTicketInput({ ticket: ticket(description) }).relevant, false, description);
  }
  assert.equal(planTicketInput({ ticket: ticket('Сидоров Илья перестал работать у нас. Все учётки закрыть.') }).relevant, true);
});

test('late affirmative employment and cancellation cannot be lost behind technical comments', () => {
  const comments = [{ _id: 'departure', content: 'Сидоров Илья уволен.' }, ...Array.from({ length: 5 }, (_, i) => ({ _id: `tech${i}`, content: 'Диагностика принтера завершена.' })), { _id: 'still-working', content: 'Он по-прежнему работает у нас.' }, { _id: 'cancel', content: 'Отбой, больше не нужно.' }];
  const plan = planTicketInput({ ticket: ticket('FineReader'), comments });
  const payload = JSON.parse(plan.prompt.user).sources.map((source) => source.text).join('\n');
  assert.ok(payload.includes('Он по-прежнему работает у нас.'));
  assert.ok(payload.includes('Отбой, больше не нужно.'));
});

test('explicit named closing, blocking and restriction survive technical problems in the same message', () => {
  for (const description of ['Сидоров Илья: отключить все доступы. Ещё у него не работает принтер.', 'Сидоров Илья: заблокировать учётную запись. Есть ошибка пароля в другой системе.', 'Сидоров Илья: ограничить доступ только к VPN. Ещё программа выдаёт ошибку.']) {
    const plan = planTicketInput({ ticket: ticket(description) });
    assert.equal(plan.relevant, true, description);
    assert.ok(JSON.parse(plan.prompt.user).sources.some((source) => source.text === description));
  }
  assert.equal(planTicketInput({ ticket: ticket('Сидоров Илья забыл пароль, разблокировать доступ к почте.') }).relevant, false);
});

test('late date changes and identity corrections invalidate old selected input despite intervening technical history', () => {
  const source = ticket('Сидоров Илья уволен. Закрыть все доступы 15 ноября.');
  const technical = Array.from({ length: 80 }, (_, i) => ({ _id: `technical${i}`, content: 'Принтер проверили.' }));
  const before = planTicketInput({ ticket: source, comments: technical });
  const corrections = [{ _id: 'reschedule', content: 'Перенесите отключение на 25 ноября.' }, { _id: 'name-correction', content: 'Правильно: Сидоров Игорь, не Илья.' }];
  const after = planTicketInput({ ticket: source, comments: [...technical, ...corrections] });
  const payload = JSON.parse(after.prompt.user).sources.map((item) => item.text).join('\n');
  assert.ok(payload.includes('Перенесите отключение на 25 ноября.'));
  assert.ok(payload.includes('Правильно: Сидоров Игорь, не Илья.'));
  assert.notEqual(after.inputFingerprint, before.inputFingerprint);
});

test('late cancellation variants survive without named people or adjacent personnel messages', () => {
  for (const cancellation of ['Заявка больше не актуальна.', 'Не нужно.', 'Больше не требуется.']) {
    const plan = planTicketInput({ ticket: ticket('Сидоров Илья уволен.'), comments: [{ _id: 'technical', content: 'Программу проверили.' }, { _id: 'cancellation', content: cancellation }] });
    assert.ok(JSON.parse(plan.prompt.user).sources.some((source) => source.text === cancellation), cancellation);
  }
});

test('explicit employment title retains a single unknown surname while quoted-only replies stay irrelevant', () => {
  const plan = planTicketInput({ ticket: ticket('Сидоров', { title: 'Увольнение' }), users: [] });
  assert.equal(plan.relevant, true);
  assert.deepEqual(JSON.parse(plan.prompt.user).sources.map((source) => source.text), ['Увольнение', 'Сидоров']);
  assert.equal(planTicketInput({ ticket: ticket('> Сидоров уволен.', { title: 'Re: Увольнение' }) }).relevant, false);
});

test('late ongoing access need and contract work cannot reuse an old departure-only input', () => {
  const source = ticket('Сидоров Илья уволен. Закрыть все доступы.');
  const technical = Array.from({ length: 5 }, (_, i) => ({ _id: `technical${i}`, content: 'Принтер проверили.' }));
  const before = planTicketInput({ ticket: source, comments: technical });
  for (const content of ['Его доступ ещё нужен до конца месяца.', 'Сидоров Илья продолжает сотрудничество по договору, все права ему нужны.']) {
    const plan = planTicketInput({ ticket: source, comments: [...technical, { _id: 'preserve', content }] });
    assert.ok(JSON.parse(plan.prompt.user).sources.some((entry) => entry.text === content), content);
    assert.notEqual(plan.inputFingerprint, before.inputFingerprint);
  }
});


test('previously unseen technical product names use intent rather than name exceptions', () => {
  for (const description of ['NebulaScanner вернул ошибку лицензии.', 'В программе Polar Dusk больше не работает вход, восстановите доступ к лицензии.', 'Приложение Lumen Forge перестало работать. Восстановите подключение.', 'Сервис Заполярный Документ вернул ошибку 500.']) {
    assert.equal(planTicketInput({ ticket: ticket(description) }).relevant, false, description);
    assert.equal(planTicketInput({ ticket: ticket(description), comments: [{ content: 'Сидоров Илья уволен.' }] }).relevant, true);
  }
});

test('single given name departure with an old account and unrelated error remains a live candidate', () => {
  const description = 'Марина, больше не работает. По ошибке отправила вам с её старого аккаунта. Прошу ответить на другой адрес.';
  const plan = planTicketInput({ ticket: ticket(description, { title: 'Сайт' }), comments: [{ content: 'Компания не имеет работника Марину и не обращалась за помощью.' }], users: [] });
  assert.equal(plan.relevant, true);
  assert.equal(plan.selectedSourceCount, 3);
  assert.ok(JSON.parse(plan.prompt.user).sources.some((source) => source.text.includes('не имеет работника')));
  assert.equal(planTicketInput({ ticket: ticket('марина больше не работает.'), users: [{ firstName: 'Марина', lastName: 'Сидорова', company: { _id: 'a' } }] }).relevant, true);
});

test('arbitrary current human followups invalidate old evidence input even without a known keyword', () => {
  const source = ticket('Сидоров Илья уволен. Закрыть все доступы.');
  const before = planTicketInput({ ticket: source });
  for (const content of ['Пожалуйста, пока не спешите.', 'Он вернулся.', 'К этому человеку сказанное выше не относится.', 'Срок ещё согласуем с директором.']) {
    const after = planTicketInput({ ticket: source, comments: [{ _id: 'human', content }] });
    assert.ok(JSON.parse(after.prompt.user).sources.some((entry) => entry.text === content), content);
    assert.notEqual(after.inputFingerprint, before.inputFingerprint);
  }
});

test('JSON envelopes with free human prose retain late qualifiers and invalidate cached input', () => {
  const source = ticket('Сидоров Илья уволен. Закрыть все доступы.');
  const before = planTicketInput({ ticket: source });
  for (const payload of [{ type: 'health', message: 'Пока поживёт с прежними правами' }, { type: 'diagnostic', note: 'Пожалуйста, пока не спешите.' }, { type: 'health', comment: 'К этому человеку сказанное выше не относится.' }, { type: 'metrics', metrics: { cpu: 0.1, note: 'Срок ещё согласуем.' } }, { type: 'health', status: 'Пока ничего менять не требуется.' }]) {
    const content = JSON.stringify(payload);
    const after = planTicketInput({ ticket: source, comments: [{ _id: 'qualifier', content }] });
    assert.ok(JSON.parse(after.prompt.user).sources.some((entry) => entry.text === content), content);
    assert.notEqual(after.inputFingerprint, before.inputFingerprint);
  }
});

test('unknown single names before an implicit departure do not require a comma or a directory match', () => {
  for (const description of ['Сидоров больше не работает.', 'Сидоров больше не работает у нас.', 'Марина больше не работает.']) {
    assert.equal(planTicketInput({ ticket: ticket(description), users: [] }).relevant, true, description);
  }
});

test('a person in ordinary support text does not make exceptions, dates, placement or new onboarding a lifecycle signal', () => {
  for (const description of ['Сидоров Илья: поставить программу и проверить доступ к папке.', 'Сидоров Илья: всё работает, кроме принтера.', 'Сидоров Илья: возникло исключение при печати.', 'Сидоров Илья: дату накладной исправьте на 25 ноября.', 'Сидоров Илья принят на работу.']) {
    assert.equal(planTicketInput({ ticket: ticket(description) }).relevant, false, description);
  }
  assert.equal(planTicketInput({ ticket: ticket('Сидоров Илья продолжает сотрудничество по договору, доступ нужен.') }).relevant, true);
});

test('a return heading composes with the current human identity in a separate root source', () => {
  for (const title of ['Вернулся', 'Снова работает']) {
    assert.equal(planTicketInput({ ticket: ticket('Сидоров Илья', { title }), users: [] }).relevant, true, title);
  }
});

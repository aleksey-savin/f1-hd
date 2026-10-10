// Воркер применения одобренных запросов на изменение Mikrotik: очередь, повторная сверка с роутером,
// бэкап, исполнение, итог, истечение и напоминания. Итог решает повторное чтение роутера, а не слова исполнителя.
// Всё внешнее приходит аргументами (хранилище, чтение разделов, исполнитель, бэкап, уведомитель, ключи, часы, журнал);
// модели и логгер подключаются лениво в mongoStore / mongoWorker — модуль грузится без базы.
//
// Допущение: один процесс backend. Очерёдность по устройству и транзиту держит замок в памяти
// плюс атомарный захват запроса в базе; для нескольких процессов нужен замок в базе.
const { STATUS, isOpen } = require("./changeSteps");
const { apiWords } = require("./changeRender");
const { PLACEHOLDERS } = require("./changeRules");
const { norm, matches, redactedBefore, diffField } = require("./changeMatch");
const { FAILURES, TEXTS: EXEC } = require("./changeExecutor");
const { executorMode } = require("./changeExecutorMode");
const { isUpgrading } = require("./upgradeGuard");
const { assessChangeRights } = require("./upgradeRights");

const HOUR = 3600 * 1000;
const KEYS_TTL_MS = 24 * HOUR;
const REMIND_BEFORE_MS = 2 * HOUR;
const STALE_APPLYING_MS = 10 * 60 * 1000;
const VERIFY_ATTEMPTS = 3;
const VERIFY_PAUSE_MS = 3000;
const MAX_ERROR = 300;
const WG_MENU = "/interface wireguard";
// Поля, которых роутер в строке не печатает
const NOT_ECHOED = new Set(["place-before", "copy-from"]);
const RETRY_AFTER_MS = 60 * 1000;
const BACKUP_MAX_AGE_MS = 10 * 60 * 1000;
const GIVE_UP_MS = 30 * 60 * 1000;
const STALE_APPROVAL = "Утверждение устарело: с момента решения прошло больше 30 минут, изменения не вносились. Запросите заново.";
const WAIT_PREFIX = "Ожидание: ";
const WG_NOT_SAVED = "Конфигурация для сотрудника не сохранена; если пир остался на устройстве, удалите его и запросите заново.";
// Отказы исполнителя до первой отправленной команды
const NOT_STARTED = new Set([FAILURES.held, FAILURES.unconfirmed, FAILURES.unconfirmedTimeout, FAILURES.lostOnEntry, FAILURES.lostBeforeCommand, FAILURES.noCommand]);
const SILENT = new Set([FAILURES.silent, FAILURES.probeTimeout, FAILURES.sessionLost]);
// Safe mode перехвачен другим администратором: за состояние роутера поручиться нельзя
const TAKEN_OVER = new Set([FAILURES.lost, FAILURES.lostBeforeRelease]);

const TEXT = {
  backup: "Снята резервная копия",
  expired: "Запрос истёк",
  reminded: "Напоминание отправлено",
  held: "Safe mode занят другим администратором — изменения не вносились",
  noSafeMode: "Не удалось войти в safe mode — изменения не вносились",
  noConnect: "Не удалось подключиться к устройству — изменения не вносились",
  silent: "Устройство перестало отвечать после применения, роутер откатил изменения",
  interrupted: "Применение было прервано; состояние устройства неизвестно",
  crashedAfter: "Применение прервано внутренней ошибкой; состояние устройства неизвестно",
  crashedBefore: "Внутренняя ошибка: изменения не вносились",
  notStarted: "Применение не началось из-за внутренней ошибки — изменения не вносились",
};

const oneLine = (text, max = MAX_ERROR) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const rollback = (n) => `Команда ${n} не выполнилась, роутер откатил изменения`;

// 1 команда, 2–4 команды, 5+ команд
function commandsApplied(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `Применена ${n} команда`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `Применено ${n} команды`;
  return `Применено ${n} команд`;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const joinIndexes = (list) => list.map((i) => i + 1).join(", ");
const lastApproval = (change) => [...(change.steps || [])].reverse().find((s) => s.decision === "approve") || null;
const lastApprover = (change) => lastApproval(change)?.user ?? null;
// Когда принято последнее утверждающее решение; null — времени нет (старый документ)
const approvedAt = (change) => {
  const at = lastApproval(change)?.decidedAt;
  const date = at ? new Date(at) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
// Исполнитель собирается при первом применении: sweep (истечение, напоминания, ключи) от него не зависит.
// prepare зовётся до бэкапа — несобравшийся исполнитель даёт «изменения не вносились», а не «состояние неизвестно»
const lazyExecutor = (factory) => {
  let built = null;
  const get = () => (built ||= factory());
  return { prepare: () => void get(), applyCommands: (record, items) => get().applyCommands(record, items) };
};
// Секреты WireGuard наружу (уведомитель, журнал) не отдаём, даже если хранилище их вернуло
const publicChange = (doc) => {
  if (!doc?.wireguard) return doc;
  const { privateKey, presharedKey, ...wireguard } = doc.wireguard;
  void privateKey;
  void presharedKey;
  return { ...doc, wireguard };
};

// --- сверка и проверка по строкам

// Что сейчас на роутере по команде: present | absent | unknown
function observe(item, pre, post, values, claimed) {
  const { command, id } = item;
  if (!post) return "unknown";
  const params = Object.entries(command.params || {}).filter(([name, value]) => !NOT_ECHOED.has(name) && value !== PLACEHOLDERS.presharedKey);
  const expected = params.map(([name, value]) => [name, value === PLACEHOLDERS.publicKey ? values[PLACEHOLDERS.publicKey] : value]);
  const same = (row) => expected.every(([name, value]) => row[name] !== undefined && norm(row[name]) === norm(value));
  if (command.action === "add") {
    const known = new Set((pre || []).map((r) => r[".id"]));
    const fresh = post.filter((r) => !known.has(r[".id"]));
    // Одна новая строка засчитывается одной команде
    const hit = fresh.find((r) => same(r) && !claimed.has(`${command.path}\n${r[".id"]}`));
    if (hit) {
      claimed.add(`${command.path}\n${hit[".id"]}`);
      return "present";
    }
    return fresh.length ? "unknown" : "absent";
  }
  const row = post.find((r) => r[".id"] === id);
  if (command.action === "remove") return row ? "absent" : "present";
  if (!row) return "unknown";
  if (command.action === "set") {
    if (same(row)) return "present";
    const before = command.before || {};
    const untouched = Object.keys(command.params || {}).every((name) => (row[name] === undefined) === (before[name] === undefined) && (row[name] === undefined || norm(row[name]) === norm(before[name])));
    return untouched ? "absent" : "unknown";
  }
  // enable / disable
  const want = command.action === "enable" ? "no" : "yes";
  return norm(row.disabled ?? "no") === want ? "present" : "absent";
}

function summary(states) {
  if (states.every((s) => s === "absent")) return "изменений на роутере нет";
  if (states.every((s) => s === "present")) return "все команды на месте";
  const part = (name, label) => {
    const list = states.map((s, i) => (s === name ? i : -1)).filter((i) => i >= 0);
    return list.length ? `${label} ${joinIndexes(list)}` : null;
  };
  return [part("present", "на месте команды"), part("absent", "нет команд"), part("unknown", "неясно по командам")].filter(Boolean).join("; ");
}

// --- воркер

function createChangeWorker({ store, readMenus, readRights, executor, backup, notifier, keys, now = () => new Date(), log, sleep }) {
  const pause = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const warn = (message, meta) => {
    try { log?.log?.("warn", `Mikrotik change worker: ${message}`, meta); } catch { /* журнал не критичен */ }
  };
  // Всё, что пишется после создания ключей, проходит через это
  // Ключ режется по первым 12 символам вместе с хвостом: текст роутера мог обрезаться посреди ключа
  const scrub = (flag, text) =>
    (flag?.secrets || []).reduce(
      (t, secret) => (secret ? t.replace(new RegExp(`${escapeRe(String(secret).slice(0, 12))}[A-Za-z0-9+/=]*`, "g"), "***") : t),
      String(text ?? ""),
    );
  // Когда запрос можно пробовать снова (в памяти): ожидающий не чаще раза в минуту
  const nextAttempt = new Map();
  const notify = async (event, change) => {
    try { await notifier?.[event]?.(publicChange(change)); } catch (error) { warn(`notify ${event} #${change?.number}`, { error: error?.message }); }
  };

  // Дорожка: транзит, если он есть, иначе само устройство — как у liveLimiter. Две правки одного
  // устройства и две правки через один транзит держат одну дорожку.
  const busyLanes = new Set();
  const activeIds = new Set();
  const laneOf = (record) => String(record.jumpRecordId || record._id);

  // Записать итог и сообщить; null — запрос уже не applying (чужая запись)
  async function finish(change, outcome, { notifyResult = true } = {}) {
    const at = now();
    nextAttempt.delete(String(change._id));
    // Ключи не сохранены ни при каком исходе, кроме applied: человеку нужно знать, что делать с пиром
    if (change.wireguard?.client && outcome.failure && (outcome.status === STATUS.needsAttention || outcome.status === STATUS.rolledBack)) {
      const original = outcome.failure;
      outcome = { ...outcome, failure: `${original} ${WG_NOT_SAVED}`, timeline: (outcome.timeline || []).map((t) => (t === original ? `${original} ${WG_NOT_SAVED}` : t)) };
    }
    const set = { status: outcome.status };
    const unset = ["applyingSince"];
    if (outcome.failure) set.failure = outcome.failure;
    else unset.push("failure");
    if (outcome.executor) set.executor = outcome.executor;
    (outcome.states || []).forEach((state, i) => {
      if (state) set[`commands.${i}.result`] = { state: state.state, at, ...(state.error ? { error: state.error } : {}), ...(state.refused === true && state.error ? { refused: true } : {}) };
    });
    Object.assign(set, outcome.set || {});
    const updated = await store.update(change._id, {
      from: STATUS.applying,
      set,
      unset,
      timeline: (outcome.timeline || []).map((text) => ({ at, kind: "result", text })),
    });
    if (!updated) {
      warn(`#${change.number}: final status ${outcome.status} not written, the change is no longer applying`);
      return { changeId: change._id, status: null };
    }
    if (notifyResult) await notify("result", updated);
    return { changeId: change._id, status: outcome.status };
  }

  // Начать не удалось, ничего не вносилось: остаёмся в очереди (одна заметка на причину, повтор не чаще раза в минуту)
  // или через 30 минут сдаёмся. from — статус документа сейчас: queued (не захвачен) или applying (захвачен)
  async function wait(change, reason, from, raw) {
    const at = now();
    warn(`#${change.number} cannot start: ${reason}${raw ? ` (${oneLine(raw)})` : ""}`);
    nextAttempt.set(String(change._id), at.getTime() + RETRY_AFTER_MS);
    const since = change.queuedSince ? new Date(change.queuedSince) : null;
    if (since && at.getTime() - since.getTime() >= GIVE_UP_MS) {
      nextAttempt.delete(String(change._id));
      const failure = `Не удалось начать применение за 30 минут: ${reason}`;
      if (from === STATUS.applying) return finish(change, { status: STATUS.notApplied, failure, timeline: [failure] });
      // Без захвата: записать итог условно из queued; не вышло — остаётся queued до следующего тика
      try {
        const updated = await store.update(change._id, {
          from: STATUS.queued,
          set: { status: STATUS.notApplied, failure },
          timeline: [{ at, kind: "result", text: failure }],
        });
        if (!updated) return null;
        await notify("result", updated);
        return { changeId: change._id, status: STATUS.notApplied };
      } catch (error) {
        warn(`#${change.number} could not give up waiting`, { error: oneLine(error?.message) });
        return null;
      }
    }
    const note = `${WAIT_PREFIX}${reason}`;
    const seen = (change.timeline || []).some((t) => t.kind === "wait" && t.text === note);
    const timeline = seen ? [] : [{ at, kind: "wait", text: note }];
    if (from === STATUS.applying) {
      await store.update(change._id, { from, set: { status: STATUS.queued }, unset: ["applyingSince"], timeline });
    } else if (timeline.length) {
      await store.update(change._id, { from, timeline });
    }
    return null;
  }

  async function apply(change, record, flag) {
    const secrets = flag.secrets;
    const line = (text, max = MAX_ERROR) => oneLine(scrub(flag, text), max);
    const stop = (status, failure) => finish(change, { status, failure, timeline: [failure] });

    // Сбой чтения до применения. Ждём только то, что может пройти: обновление, занятость, обрыв связи;
    // остальное (пароль, пин, запрет адреса) — null, решает вызывающий
    const waitOnRead = (error) => {
      const text = String(error?.message || "no answer");
      if (error?.code === "MIKROTIK_LIVE_UPGRADING") return wait(change, "устройство обновляется", STATUS.applying, text);
      if (error?.code === "MIKROTIK_LIVE_BUSY") return wait(change, "устройство занято", STATUS.applying, text);
      if (error?.code !== "MIKROTIK_BLOCKED_HOST" && error?.transient === true) return wait(change, "устройство не отвечает", STATUS.applying, text);
      return null;
    };

    // 1. Чтение разделов: один вызов
    const commands = change.commands || [];
    if (!commands.length) return stop(STATUS.notApplied, "В запросе нет команд");
    const wg = change.wireguard?.client || null;
    const paths = [...new Set([...commands.map((c) => c.path), ...(wg ? [WG_MENU] : [])])];
    let read;
    try {
      read = await readMenus(change.mikrotik, paths);
    } catch (error) {
      const text = String(error?.message || "no answer");
      const waiting = waitOnRead(error);
      if (waiting) return waiting;
      warn(`#${change.number} read failed for good: ${line(text)}`, { code: error?.code });
      return stop(STATUS.notApplied, `Не удалось прочитать устройство: ${line(text, 200)}`);
    }
    const menus = new Map();
    for (const path of paths) if (read.get(path)?.rows) menus.set(path, read.get(path).rows);

    // 2. Повторная сверка: строка, id, дрейф
    const plan = [];
    for (let i = 0; i < commands.length; i += 1) {
      const command = commands[i];
      const n = i + 1;
      const drift = (what) => stop(STATUS.notApplied, `Конфигурация изменилась с момента запроса: команда ${n} — ${what}`);
      const rows = menus.get(command.path);
      if (!rows) return drift(`раздел не читается: ${line(read.get(command.path)?.error || "нет ответа", 120)}`);
      if (command.action === "add") {
        plan.push({ command, id: null });
        continue;
      }
      const where = command.where || {};
      if (!Object.keys(where).length) return drift("не задано условие поиска строки");
      const hit = rows.filter((row) => matches(row, where));
      if (hit.length === 0) return drift("строка не найдена");
      if (hit.length > 1) return drift(`под условие подходят несколько строк (${hit.length})`);
      if (!command.before) return drift("нет снимка строки на момент запроса");
      // Под тем же where теперь другая строка: люди утверждали не её
      if (command.rowId && hit[0][".id"] !== command.rowId) return stop(STATUS.notApplied, `Команда ${n}: строка заменена другой с момента запроса`);
      const fresh = redactedBefore(command.path, hit[0]);
      // Вся строка без бегущих полей своего раздела (то же, что sameConfig); set вдобавок сверяет точно то,
      // что меняет, — даже бегущее поле
      const names = Object.keys(command.params || {}).filter((name) => !Object.values(PLACEHOLDERS).includes(command.params[name]));
      const differs = (command.action === "set" ? diffField(command.path, fresh, command.before, names) : null) || diffField(command.path, fresh, command.before);
      if (differs) return drift(`строка изменилась (поле ${oneLine(differs, 60)})`);
      plan.push({ command, id: hit[0][".id"] });
    }

    // 3. Сервер WireGuard: ключ и порт читаются с роутера
    let server = null;
    if (wg) {
      const row = (menus.get(WG_MENU) || []).find((r) => r.name === wg.interface);
      if (!row || !row["public-key"]) return stop(STATUS.notApplied, `Интерфейс WireGuard «${oneLine(wg.interface, 60)}» не найден на устройстве`);
      const endpoint = wg.endpoint || (row["listen-port"] ? `${record.credentials?.host}:${row["listen-port"]}` : null);
      if (!endpoint) return stop(STATUS.notApplied, `У интерфейса WireGuard «${oneLine(wg.interface, 60)}» не задан порт`);
      server = { publicKey: row["public-key"], endpoint };
    }

    // 4. Ключи: только здесь, после сверки; в запись попадают лишь при успехе
    const usesValue = (placeholder) => commands.some((c) => Object.values(c.params || {}).includes(placeholder));
    const values = {};
    let pair = null;
    let psk = null;
    let sealed = null;
    if (wg) {
      pair = keys.generateKeyPair();
      secrets.push(pair.privateKey);
      values[PLACEHOLDERS.publicKey] = pair.publicKey;
      if (usesValue(PLACEHOLDERS.presharedKey)) {
        psk = keys.generatePresharedKey();
        secrets.push(psk);
        values[PLACEHOLDERS.presharedKey] = psk;
      }
      // Шифруем сразу: сломанный ключ окружения должен выясниться до того, как роутер изменён
      try {
        sealed = { privateKey: keys.encrypt(pair.privateKey), presharedKey: psk ? keys.encrypt(psk) : null };
      } catch {
        return stop(STATUS.notApplied, "Не удалось зашифровать ключи: проверьте ключ шифрования на сервере");
      }
    } else if (usesValue(PLACEHOLDERS.publicKey) || usesValue(PLACEHOLDERS.presharedKey)) {
      return stop(STATUS.notApplied, "Команда использует ключи WireGuard, но в запросе нет настроек клиента");
    }

    // 5. Слова API
    const items = [];
    for (let i = 0; i < plan.length; i += 1) {
      try {
        items.push({ words: apiWords(plan[i].command, { id: plan[i].id, values }) });
      } catch (error) {
        return stop(STATUS.notApplied, `Не удалось подготовить команду ${i + 1}: ${line(error.message, 200)}`);
      }
    }

    // Права учётной записи на устройстве: без write/ssh/api/read применять нечем — отказ до бэкапа.
    // Нечем судить (списки не читаются без политики policy) — идём дальше, роутер ответит сам
    if (readRights) {
      let rights = null;
      try {
        rights = assessChangeRights(await readRights(record));
      } catch (error) {
        const waiting = waitOnRead(error);
        if (waiting) return waiting;
        warn(`#${change.number} rights check skipped: ${line(error?.message)}`, { code: error?.code });
      }
      // Вердикта нет (списки не читаются, учётная запись или группа не найдены) — не молчим об этом
      if (!rights) warn(`#${change.number} rights check gave no verdict: applying without it`);
      if (rights && !rights.ok) {
        return stop(STATUS.notApplied, `У учётной записи HD на устройстве нет ${rights.missing.length > 1 ? "политик" : "политики"} ${rights.missing.join(", ")}: изменения не вносились.`);
      }
    }
    // Исполнитель должен собраться до бэкапа и до первой команды
    await executor.prepare?.();

    // 6. Бэкап: на запрос не больше одного (после возврата в очередь берём прежний)
    let backupId = change.backupArtifact || null;
    // Прежний бэкап устарел: ему больше 10 минут или после него другой запрос на устройстве дошёл до итога
    if (backupId) {
      const takenAt = [...(change.timeline || [])].reverse().find((t) => t.kind === "backup")?.at;
      const stale = !takenAt || now().getTime() - new Date(takenAt).getTime() > BACKUP_MAX_AGE_MS
        || (await store.finishedSince(change.mikrotik, new Date(takenAt), change._id));
      if (stale) backupId = null;
    }
    if (!backupId) {
      let artifact;
      try {
        artifact = await backup(record, { trigger: "pre-change", userId: lastApprover(change) });
        if (!artifact?._id) throw new Error("no backup returned");
      } catch (error) {
        return stop(STATUS.notApplied, `Не удалось снять резервную копию: ${line(error.message, 200)}`);
      }
      backupId = artifact._id;
      const linked = await store.update(change._id, { from: STATUS.applying, set: { backupArtifact: backupId }, timeline: [{ at: now(), kind: "backup", text: TEXT.backup }] });
      if (!linked) {
        warn(`#${change.number}: backup link not written, the change is no longer applying; the executor was not called`);
        return null;
      }
    }

    // 7. Исполнение. С этого момента роутер мог измениться
    flag.executorCalled = true;
    const run = await executor.applyCommands(record, items);
    if (!run || !Array.isArray(run.results) || run.results.length !== items.length) throw new Error("the executor returned a malformed result");
    if (run.failure) warn(`#${change.number} executor: ${line(run.failure)}`, { mode: run.executor, rolledBack: run.rolledBack, reachable: run.reachable });
    const results = run.results.map((r) => ({ state: r.state, error: r.error ? line(r.error) : null, ...(r.refused === true ? { refused: true } : {}) }));
    const execOk = results.every((r) => r.state === "done");
    const executorMode = run.executor === "api" ? "api" : "safe-mode";
    const api = executorMode === "api";
    const base = { executor: executorMode };

    // Ничего не отправлено
    const allSkipped = results.every((r) => r.state === "skipped");
    // Все команды skipped и отката не было — на роутер не ушло ничего (отправленная команда skipped не бывает),
    // по какой бы причине исполнитель ни остановился: проверять чтением нечего, «откатом» это не называем
    const known = Boolean(run.failure) && (NOT_STARTED.has(run.failure) || run.failure.startsWith(EXEC.openConsole) || run.failure.startsWith(EXEC.openApi));
    const notSent = allSkipped && !run.rolledBack && Boolean(run.failure);
    if (notSent) {
      if (run.failure.includes(EXEC.upgrading)) return wait(change, "устройство обновляется", STATUS.applying);
      const failure = !known ? TEXT.notStarted : run.failure === FAILURES.held ? TEXT.held : api || run.failure.startsWith(EXEC.openApi) ? TEXT.noConnect : TEXT.noSafeMode;
      return finish(change, { ...base, status: STATUS.notApplied, failure, states: results, timeline: [failure] });
    }

    // Выход подтверждён консолью и роутер отвечает — проверка не нужна
    if (execOk && run.releaseConfirmed && !run.failure && run.reachable !== false && !run.rolledBack) {
      return applied(results, [`${commandsApplied(items.length)}, устройство отвечает`]);
    }

    // 8. Проверка чтением: слову исполнителя «нет» не верим (команда по таймауту могла дойти позже)
    const check = await verify();
    const failedAt = results.findIndex((r) => r.state === "failed");
    // Отправленная команда считается невыполненной только при отказе роутера (!trap): обрыв, таймаут и «не подтверждено» могут ещё дойти
    const timedOut = results.some((r) => r.state === "failed" && r.refused !== true);
    const taken = TAKEN_OVER.has(run.failure);

    const attention = (failure, states) => finish(change, { ...base, status: STATUS.needsAttention, failure, states, timeline: [failure] });
    // Состояния команд по итогам проверки: на месте — done, нет — как сказал исполнитель либо rolled_back
    const byCheck = () => results.map((r, i) => {
      const seen = check.states[i];
      if (seen === "present") return { state: "done", error: null };
      // Откат есть только в safe mode; в api «выполнена, но не найдена» — не откат, а расхождение
      if (seen === "absent") return r.state === "failed" || r.state === "skipped" ? r : api ? { state: "failed", error: "не найдена при проверке" } : { state: "rolled_back", error: r.error };
      return r;
    });

    if (!check.readable) {
      return attention(`${firstSentence(run, failedAt)}; проверить состояние устройства не удалось`, results);
    }
    const allPresent = check.states.every((s) => s === "present");
    const allAbsent = check.states.every((s) => s === "absent");

    if (allPresent && execOk && !taken) {
      const note = !api && !run.releaseConfirmed
        ? "Выход из safe mode не подтверждён консолью, но повторное чтение показало, что все команды на месте"
        : "Консоль не подтвердила применение, но повторное чтение показало, что все команды на месте";
      return applied(results, [note, `${commandsApplied(items.length)}, устройство отвечает`]);
    }

    if (allAbsent && !timedOut && !taken) {
      if (api) {
        // Отката нет, но и применённого нет
        // «Не вносилось» только если исполнитель тоже ничего не выполнил; иначе он и роутер расходятся
        if (failedAt >= 0 && !results.some((r) => r.state === "done")) {
          const failure = `Команда ${failedAt + 1} не выполнилась, изменения не вносились`;
          return finish(change, { ...base, status: STATUS.notApplied, failure, states: results, timeline: [failure] });
        }
      } else {
        const failure = failedAt >= 0 ? rollback(failedAt + 1)
          : SILENT.has(run.failure) || run.reachable === false ? TEXT.silent
          : execOk && !run.releaseConfirmed ? `Выход из safe mode не подтверждён; проверка показала: ${summary(check.states)}`
          : `Применение не удалось, роутер откатил изменения; проверка показала: ${summary(check.states)}`;
        const rolled = results.map((r) => (r.state === "done" ? { state: "rolled_back", error: null } : r));
        return finish(change, { ...base, status: STATUS.rolledBack, failure, states: rolled, timeline: [failure] });
      }
    }

    // Часть есть, часть нет, неясно, safe mode перехвачен, в api упала команда — поручиться нечем
    const seen = summary(check.states);
    const failure = taken ? `Safe mode перехвачен другим администратором; проверка показала: ${seen}`
      : execOk && !run.releaseConfirmed ? `Выход из safe mode не подтверждён; проверка показала: ${seen}`
      : api && failedAt >= 0 ? `Команда ${failedAt + 1} не выполнилась, откат не предусмотрен; проверка показала: ${seen}`
      : `Состояние устройства неясно; проверка показала: ${seen}`;
    return attention(failure, byCheck());

    // --- вложенные помощники этапа 8

    function firstSentence(r, failed) {
      if (failed >= 0) return `Команда ${failed + 1} не выполнилась`;
      return SILENT.has(r.failure) || r.reachable === false ? "Устройство перестало отвечать после применения" : "Исполнитель не подтвердил результат";
    }

    function applied(states, timeline) {
      const at = now();
      const set = {};
      if (wg && pair) {
        set["wireguard.publicKey"] = pair.publicKey;
        set["wireguard.privateKey"] = sealed.privateKey;
        if (sealed.presharedKey) set["wireguard.presharedKey"] = sealed.presharedKey;
        set["wireguard.serverPublicKey"] = server.publicKey;
        set["wireguard.endpoint"] = server.endpoint;
        set["wireguard.keysExpireAt"] = new Date(at.getTime() + KEYS_TTL_MS);
      }
      return finish(change, { ...base, status: STATUS.applied, states: states.map(() => ({ state: "done", error: null })), timeline, set });
    }

    async function verify() {
      for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
        try {
          const claimed = new Set();
          const after = await readMenus(change.mikrotik, paths);
          return {
            readable: true,
            states: plan.map((item) => observe(item, menus.get(item.command.path), after.get(item.command.path)?.rows, values, claimed)),
          };
        } catch (error) {
          warn(`#${change.number} verification read ${attempt}/${VERIFY_ATTEMPTS} failed`, { error: line(error?.message) });
          if (attempt < VERIFY_ATTEMPTS) await pause(VERIFY_PAUSE_MS);
        }
      }
      return { readable: false, states: [] };
    }
  }

  // Любое необработанное исключение после захвата: запрос не остаётся в applying
  async function settleAfterCrash(change, flag, error) {
    warn(`#${change.number} unexpected error`, { error: oneLine(scrub(flag, error?.message)), executorMayHaveRun: flag.executorCalled });
    const failure = flag.executorCalled ? TEXT.crashedAfter : TEXT.crashedBefore;
    const status = flag.executorCalled ? STATUS.needsAttention : STATUS.notApplied;
    try {
      return await finish(change, { status, failure, timeline: [failure] });
    } catch (second) {
      warn(`#${change.number} could not record the outcome`, { error: oneLine(scrub(flag, second?.message)) });
      return { changeId: change._id, status: null };
    }
  }

  // Утверждение устарело: итог пишется условно из queued (без захвата, на роутер ничего не уходит).
  // Не записалось — запрос остаётся как есть до следующего тика
  async function expireApproval(change) {
    const at = now();
    nextAttempt.delete(String(change._id));
    // Запрос ждал по известной причине — называем её, как при сдаче ожидания
    const waited = [...(change.timeline || [])].reverse().find((t) => t.kind === "wait" && String(t.text).startsWith(WAIT_PREFIX));
    const failure = waited ? `Не удалось начать применение за 30 минут: ${String(waited.text).slice(WAIT_PREFIX.length)}` : STALE_APPROVAL;
    try {
      const updated = await store.update(change._id, {
        from: STATUS.queued,
        set: { status: STATUS.notApplied, failure },
        timeline: [{ at, kind: "result", text: failure }],
      });
      if (!updated) return null;
      warn(`#${change.number} approval went stale, not applied`);
      await notify("result", updated);
      return { changeId: change._id, status: STATUS.notApplied };
    } catch (error) {
      warn(`#${change.number} could not record the stale approval`, { error: oneLine(error?.message) });
      return null;
    }
  }

  async function tick() {
    const queued = await store.listQueued();
    for (const listed of queued) {
      // Утверждение живёт 30 минут: после простоя backend или выключенного модуля запрос, утверждённый
      // давно, не применяется (у add нет защиты дрейфом). Без захвата, условно из queued — как сдача ожидания
      const decidedAt = approvedAt(listed);
      if (decidedAt && now().getTime() - decidedAt.getTime() > GIVE_UP_MS) {
        const expired = await expireApproval(listed);
        if (expired) return expired;
        continue;
      }
      if ((nextAttempt.get(String(listed._id)) || 0) > now().getTime()) continue;
      // Момент постановки в очередь — время последнего решения (решение ставит только статус); его нет — первая попытка
      const candidate = listed.queuedSince ? listed : { ...listed, queuedSince: await store.ensureQueuedSince(listed._id, decidedAt || now()) };
      const found = await store.loadDevice(candidate.mikrotik);
      const record = found?.record || null;
      if (record) {
        if (isUpgrading(record) || isUpgrading(found.jump)) {
          const gaveUp = await wait(candidate, "устройство обновляется", STATUS.queued);
          if (gaveUp) return gaveUp;
          continue;
        }
        if (await store.hasApplying(candidate.mikrotik)) {
          const gaveUp = await wait(candidate, "устройство занято", STATUS.queued);
          if (gaveUp) return gaveUp;
          continue;
        }
      }
      // Проверка дорожки и её занятие — без await между ними
      const lane = record ? laneOf(record) : `missing:${candidate._id}`;
      if (busyLanes.has(lane)) {
        const gaveUp = await wait(candidate, "устройство занято", STATUS.queued);
        if (gaveUp) return gaveUp;
        continue;
      }
      busyLanes.add(lane);
      try {
        const change = await store.claim(candidate._id, now());
        if (!change) continue;
        activeIds.add(String(change._id));
        const flag = { executorCalled: false, secrets: [] };
        try {
          if (!record) return await finish(change, { status: STATUS.notApplied, failure: "Устройство не найдено — изменения не вносились", timeline: ["Устройство не найдено — изменения не вносились"] });
          const result = await apply(change, record, flag);
          // null: начать не удалось (ожидание) — идём к следующему запросу в том же тике
          if (result && result.status) return result;
        } catch (error) {
          return await settleAfterCrash(change, flag, error);
        } finally {
          activeIds.delete(String(change._id));
        }
      } finally {
        busyLanes.delete(lane);
      }
    }
    return null;
  }

  // Каждый шаг независим: сбой одного не мешает остальным
  async function sweep() {
    const at = now();
    const step = async (name, fn) => {
      try { await fn(); } catch (error) { warn(`sweep ${name} failed`, { error: oneLine(error?.message) }); }
    };

    await step("stale", async () => {
      for (const change of await store.findStale(new Date(at.getTime() - STALE_APPLYING_MS))) {
        if (activeIds.has(String(change._id))) continue;
        // Повторять нельзя: повтор мог бы применить дважды
        await finish(change, { status: STATUS.needsAttention, failure: TEXT.interrupted, timeline: [TEXT.interrupted] });
      }
    });

    await step("expired", async () => {
      for (const change of await store.findExpired(at)) {
        const updated = await store.update(change._id, {
          from: change.status,
          set: { status: STATUS.expired },
          timeline: [{ at, kind: "expired", text: TEXT.expired }],
        });
        if (updated) await notify("expired", updated);
      }
    });

    await step("reminders", async () => {
      for (const change of await store.findDueReminders(at, new Date(at.getTime() + REMIND_BEFORE_MS))) {
        if (!isOpen(change.status)) continue;
        // Атомарно: второй процесс или sweep не получит документ
        const marked = await store.markReminded(change._id, at, { at, kind: "reminder", text: TEXT.reminded });
        if (marked) await notify("reminder", marked);
      }
    });

    await step("keys", async () => {
      await store.purgeKeys(at);
    });
  }

  return { tick, sweep };
}

// --- Единственное место с моделями; подключаются лениво, чтобы модуль грузился без базы ---

const OPEN_STATUSES = () => Object.values(STATUS).filter(isOpen);

const mongoStore = {
  async listQueued() {
    const MikrotikChange = require("@/models/mikrotikChange");
    return MikrotikChange.find({ status: STATUS.queued }).sort({ createdAt: 1 }).limit(50).lean();
  },
  // Полный документ с учётными данными (как runOnDevice); транзит — только для проверки обновления
  async loadDevice(id) {
    const Mikrotik = require("@/models/mikrotik");
    const record = await Mikrotik.findById(id);
    if (!record) return null;
    const jump = record.jumpRecordId ? await Mikrotik.findById(record.jumpRecordId).select("upgrade").lean() : null;
    return { record, jump };
  },
  // Другой запрос на устройстве дошёл до итога, меняющего роутер, после момента since
  async finishedSince(deviceId, since, exceptId) {
    return Boolean(await require("@/models/mikrotikChange").exists({
      mikrotik: deviceId,
      _id: { $ne: exceptId },
      status: { $in: [STATUS.applied, STATUS.rolledBack, STATUS.needsAttention] },
      updatedAt: { $gt: since },
    }));
  },
  async hasApplying(deviceId) {
    return Boolean(await require("@/models/mikrotikChange").exists({ mikrotik: deviceId, status: STATUS.applying }));
  },
  // Первая отметка очереди: ставится один раз, возвращается действующая
  async ensureQueuedSince(id, at) {
    const doc = await require("@/models/mikrotikChange")
      .findOneAndUpdate({ _id: id, queuedSince: null }, { $set: { queuedSince: at } }, { new: true })
      .select("queuedSince")
      .lean();
    if (doc) return doc.queuedSince;
    return (await require("@/models/mikrotikChange").findById(id).select("queuedSince").lean())?.queuedSince || at;
  },
  async claim(id, at) {
    return require("@/models/mikrotikChange")
      .findOneAndUpdate({ _id: id, status: STATUS.queued }, { $set: { status: STATUS.applying, applyingSince: at } }, { new: true })
      .lean();
  },
  async update(id, { from, set = {}, unset = [], timeline = [] }) {
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (unset.length) update.$unset = Object.fromEntries(unset.map((name) => [name, 1]));
    if (timeline.length) update.$push = { timeline: { $each: timeline } };
    return require("@/models/mikrotikChange").findOneAndUpdate({ _id: id, status: from }, update, { new: true }).lean();
  },
  async findStale(before) {
    return require("@/models/mikrotikChange").find({ status: STATUS.applying, applyingSince: { $lte: before } }).lean();
  },
  async findExpired(at) {
    return require("@/models/mikrotikChange").find({ status: { $in: OPEN_STATUSES() }, expiresAt: { $lte: at } }).lean();
  },
  async findDueReminders(at, until) {
    return require("@/models/mikrotikChange")
      .find({ status: { $in: OPEN_STATUSES() }, remindedAt: null, expiresAt: { $gt: at, $lte: until } })
      .lean();
  },
  async markReminded(id, at, entry) {
    return require("@/models/mikrotikChange")
      .findOneAndUpdate({ _id: id, status: { $in: OPEN_STATUSES() }, remindedAt: null }, { $set: { remindedAt: at }, $push: { timeline: entry } }, { new: true })
      .lean();
  },
  async purgeKeys(at) {
    const res = await require("@/models/mikrotikChange").updateMany(
      {
        "wireguard.keysExpireAt": { $lte: at },
        $or: [{ "wireguard.privateKey": { $exists: true } }, { "wireguard.presharedKey": { $exists: true } }],
      },
      { $unset: { "wireguard.privateKey": 1, "wireguard.presharedKey": 1 } },
    );
    return res.modifiedCount;
  },
};

// Боевой экземпляр. Режим исполнителя — из MIKROTIK_CHANGE_EXECUTOR через executorMode. Читается сразу при
// сборке воркера (первый тик после старта), а не при первом применении: неизвестное значение даёт громкую
// запись в журнале в первые секунды работы, и оператор видит опечатку, не дожидаясь запроса
function mongoWorker({ log } = {}) {
  const mode = executorMode(process.env, log);
  const { liveReadMenus } = require("./changeProposals");
  const { liveExecutor } = require("./changeExecutor");
  const { createArtifact } = require("./artifacts");
  const { mongoNotifier } = require("./changeNotifications");
  const { generateKeyPair, generatePresharedKey } = require("./wireguardConfig");
  const { encryptSecret } = require("../crypto/secretBox");
  return createChangeWorker({
    store: mongoStore,
    readMenus: liveReadMenus,
    // Политики группы учётной записи: /user и /user group читаются только с политикой policy — нет ответа, нет вердикта
    readRights: async (record) => {
      const read = await liveReadMenus(record._id, ["/user", "/user group"]);
      return { users: read.get("/user")?.rows, groups: read.get("/user group")?.rows, user: record.credentials?.user };
    },
    executor: lazyExecutor(() => liveExecutor({ mode, log })),
    backup: createArtifact,
    notifier: mongoNotifier({ baseUrl: process.env.APP_PUBLIC_URL || process.env.VITE_API_ADDRESS || "", log }),
    keys: { generateKeyPair, generatePresharedKey, encrypt: encryptSecret },
    now: () => new Date(),
    log,
  });
}

// Точки входа для расписания (app.js): рубильник модуля, готовность базы, один экземпляр на процесс
let worker = null;
async function ready() {
  const mongoose = require("mongoose");
  if (mongoose.connection.readyState !== 1) return null;
  if (!(await require("./enabled").mikrotikEnabled())) return null;
  return (worker ||= mongoWorker({ log: require("@/utils/logger") }));
}
const runChangeTick = async () => (await ready())?.tick();
const runChangeSweep = async () => (await ready())?.sweep();

module.exports = { createChangeWorker, lazyExecutor, mongoWorker, mongoStore, runChangeTick, runChangeSweep };

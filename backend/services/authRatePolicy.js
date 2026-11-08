const { createHash } = require('node:crypto');
const { isIP } = require('node:net');

const AUTH_IP_HEADER = 'x-hd-auth-client-ip';
const PAIR_WINDOW_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const normalizeAccount = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

function parseTrustProxyHops(value = '0') {
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error('TRUST_PROXY_HOPS must be a nonnegative integer');
  }
  return Number(value);
}

function normalizeIp(value) {
  if (typeof value !== 'string' || !isIP(value)) return 'unknown';
  if (isIP(value) === 4) return value;
  let ip;
  try { ip = new URL(`http://[${value}]/`).hostname.slice(1, -1); } catch { return "unknown"; }
  const mapped = ip.match(/^::ffff:([\da-f]+):([\da-f]+)$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return ip;
}

// Для аудита и заголовков сохраняем точный normalizeIp; только ключи лимитов
// объединяют адреса IPv6. IPv4-mapped адреса уже преобразованы к этому моменту.
function abuseIp(value) {
  const ip = normalizeIp(value);
  if (isIP(ip) !== 6) return ip;
  const [left, right] = ip.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const groups = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  return [...groups.slice(0, 4).map((part) => part.padStart(4, '0')), '0000', '0000', '0000', '0000'].join(':');
}
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const accountKey = (account) => key('account', normalizeAccount(account));
const pairKey = (kind, ip, account) => key(kind, abuseIp(ip), normalizeAccount(account));
// identity должен поступать из проверенного определителя установленного auth-контекста,
// а не из текста cookie или выбранных вызывающим именени/значения cookie.
const challengeKey = (ip, identity) => identity && typeof identity === 'object' &&
  ['session', 'challenge'].includes(identity.kind) && typeof identity.id === 'string'
  ? key('factor', identity.kind, identity.id) : key('factor-no-challenge', abuseIp(ip));

// Это ОБЯЗАТЕЛЬНО заменяет ввод вызывающего на границе Express до преобразования
// заголовков Node. better-auth не должен самостоятельно разбирать цепочку прокси.
function setAuthClientIp(req, _res, next) {
  req.headers[AUTH_IP_HEADER] = normalizeIp(req.ip);
  if (next) return next();
}
function authHeaders(req) {
  return { ...req.headers, [AUTH_IP_HEADER]: normalizeIp(req.ip) };
}

// Чистое решение для фиксированного окна. Отказы сохраняют исходный срок.
function counterStep(snapshot, time, limit, windowMs) {
  const current = snapshot && snapshot.expiresAt > time ? snapshot : { count: 0, expiresAt: time + windowMs };
  if (current.count >= limit) return { allowed: false, next: current, resetAt: current.expiresAt };
  return { allowed: true, next: { count: current.count + 1, expiresAt: current.expiresAt }, resetAt: current.expiresAt };
}

function createAuthRatePolicy({ now = Date.now, maxEntries = 10000, cooldownTtlMs = PAIR_WINDOW_MS } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('Invalid auth rate cache bound');
  const state = new Map();
  let nextPrune = 0;
  function prune(force = false) {
    const time = now();
    if (!force && time < nextPrune) return;
    for (const [id, entry] of state) if (entry.expiresAt <= time) state.delete(id);
    nextPrune = time + 1000;
  }
  function read(id) {
    prune();
    const entry = state.get(id);
    if (entry && entry.expiresAt > now()) return entry;
    state.delete(id);
    return undefined;
  }
  function write(id, entry) {
    if (!state.has(id) && state.size >= maxEntries) {
      prune(true);
      if (state.size >= maxEntries) state.delete(state.keys().next().value);
    }
    state.set(id, entry);
  }
  function reserve(id, limit, windowMs) {
    const old = read(id);
    const decision = counterStep(old, now(), limit, windowMs);
    if (!decision.allowed) return { allowed: false, resetAt: decision.resetAt, remaining: 0 };
    // Сохраняем ссылку на активную запись, чтобы успешные запросы в процессе
    // могли снять резерв даже после увеличения счётчика другим запросом.
    const entry = old ? Object.assign(old, decision.next) : decision.next;
    write(id, entry);
    return {
      allowed: true, resetAt: entry.expiresAt, remaining: Math.max(0, limit - entry.count),
      release: () => { if (state.get(id) === entry) entry.count = Math.max(0, entry.count - 1); },
    };
  }
  function consume(id, limit, windowMs) {
    const { allowed, resetAt } = reserve(id, limit, windowMs);
    return { allowed, resetAt };
  }
  function cooldown(account) {
    const entry = read(`cooldown:${accountKey(account)}`);
    return { allowed: !entry || entry.deadline <= now(), resetAt: entry?.deadline || now() };
  }
  function credentialFailure(account) {
    const id = `cooldown:${accountKey(account)}`;
    const old = read(id);
    // Ошибка уже ограниченного запросом аккаунта не усиливает блокировку и не обновляет TTL.
    if (old && old.deadline > now()) return cooldown(account);
    const failures = Math.min((old?.failures || 0) + 1, 6);
    const deadline = now() + Math.min(1000 * 2 ** (failures - 1), 30000);
    write(id, { failures, deadline, expiresAt: now() + cooldownTtlMs });
    return { allowed: false, resetAt: deadline };
  }
  const credentialSuccess = (account) => state.delete(`cooldown:${accountKey(account)}`);
  function middleware({ key: makeKey, limit, windowMs, failureOnly = false, handler }) {
    return async (req, res, next) => {
      const ticket = reserve(await makeKey(req), limit, windowMs);
      req.authRateLimit = { resetAt: ticket.resetAt };
      res.setHeader('RateLimit-Policy', `${limit};w=${Math.ceil(windowMs / 1000)}`);
      res.setHeader('RateLimit-Limit', limit);
      res.setHeader('RateLimit-Remaining', ticket.remaining);
      res.setHeader('RateLimit-Reset', Math.max(0, Math.ceil((ticket.resetAt - now()) / 1000)));
      if (!ticket.allowed) {
        res.setHeader('Retry-After', Math.max(1, Math.ceil((ticket.resetAt - now()) / 1000)));
        return handler(req, res, next, { statusCode: 429, windowMs });
      }
      if (failureOnly) res.once('finish', () => {
        if (res.statusCode < 400 || res.statusCode >= 500) ticket.release();
      });
      return next();
    };
  }
  const limitedResponse = (ticket) => new Response(JSON.stringify({ message: 'Too many requests. Please try again later.' }), {
    status: 429, headers: { 'content-type': 'application/json', 'Retry-After': String(Math.max(1, Math.ceil((ticket.resetAt - now()) / 1000))) },
  });
  async function rawRequest(request, handler, resolveFactorIdentity) {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, '');
    const ip = request.headers.get(AUTH_IP_HEADER);
    let ticket;
    if (path.startsWith('/two-factor/')) {
      const identity = resolveFactorIdentity ? await resolveFactorIdentity(request.headers, path) : null;
      ticket = reserve(challengeKey(ip, identity), 30, 10 * 60 * 1000);
    } else if (path === '/reset-password' || path === '/magic-link/verify') {
      // Ротация токена не должна превращать это в неограниченный лимит на каждый токен.
      const ipBudget = consume(`ip:${abuseIp(ip)}`, 50, HOUR_MS);
      if (!ipBudget.allowed) return limitedResponse(ipBudget);
      const body = request.method === 'POST' ? await request.clone().json().catch(() => ({})) : {};
      const token = body?.token || new URL(request.url).searchParams.get('token') || '';
      ticket = reserve(key(path, abuseIp(ip), token), path === '/reset-password' ? 10 : 5,
        path === '/reset-password' ? PAIR_WINDOW_MS : 60000);
    }
    if (ticket && !ticket.allowed) return limitedResponse(ticket);
    const response = await handler(request);
    // И успешная, и ошибочная проверка magic-link могут вернуть 302. Для надёжности
    // считаем каждый такой запрос, сохраняя исходный Response.
    if (ticket && path === '/reset-password' && (response.status < 400 || response.status >= 500)) ticket.release();
    return response;
  }
  return { consume, cooldown, credentialFailure, credentialSuccess, middleware, rawRequest,
    get size() { prune(true); return state.size; } };
}

const authRatePolicy = createAuthRatePolicy();
module.exports = { AUTH_IP_HEADER, PAIR_WINDOW_MS, HOUR_MS, normalizeAccount, normalizeIp, abuseIp,
  parseTrustProxyHops, accountKey, pairKey, challengeKey, setAuthClientIp, authHeaders,
  counterStep, createAuthRatePolicy, authRatePolicy };

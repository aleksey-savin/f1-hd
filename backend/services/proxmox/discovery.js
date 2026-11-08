const { randomUUID } = require("node:crypto");
const { rangesToAddresses, port, fail, publicError } = require("./policy");
const authorize = async (session) => {
  const prefs = await require("../../models/preferences").findOne({}).lean();
  if (!prefs?.modules?.proxmox?.isActive) fail("Модуль Proxmox выключен", 409);
  const user = await require("../../models/user").findById(session.userId);
  if (
    !user ||
    user.isEndUser ||
    require("../accountDenial").isDeniedAccount(user)
  )
    fail("Доступ к поиску отозван", 403);
  const can = await require("../permissions").canFor(user);
  if (!can({ proxmox: ["read"] }) || !can({ proxmox: ["discover"] }))
    fail("Доступ к поиску отозван", 403);
  const companyId = user.company?._id || user.company;
  if (
    companyId &&
    !(await require("../../models/company").exists({
      _id: companyId,
      isActive: { $ne: false },
    }))
  )
    fail("Компания отключена", 403);
  if (session.transport === "mikrotik") {
    if (!prefs.modules?.mikrotik?.isActive || !can({ mikrotik: ["read"] }))
      fail("Нет доступа к MikroTik", 403);
    const router = await require("../../models/mikrotik").findById(
      session.mikrotikRecordId,
    );
    if (!router || router.jumpRecordId || !router.monitoringEnabled)
      fail("Транзитное устройство недоступно", 409);
  }
};
function createSessionManager({
  validate = authorize,
  probe = (...args) => require("./transport").requestEndpoint(...args),
  now = Date.now,
  heartbeatMs = 30000,
  lifetimeMs = 600000,
  maxSessions = 16,
  maxConcurrent = 16,
  autoSchedule = true,
} = {}) {
  const sessions = new Map(),
    gateways = new Set(),
    closed = new Map();
  let turn = 0;
  let timer = null,
    inflight = 0;
  const snapshot = (s) => ({
    id: s.id,
    state: s.state,
    cursor: s.cursor,
    total: s.total,
    transport: s.transport,
    mikrotikRecordId: s.mikrotikRecordId,
    ranges: s.ranges,
    ports: s.ports,
    candidates: [...s.candidates],
    resultsLimited: Boolean(s.resultsLimited),
    error: s.error,
  });
  const owned = (id, userId) => {
    const s = sessions.get(id);
    if (!s || s.userId !== String(userId))
      fail(
        "Поиск закрыт или срок ожидания истёк. Запустите поиск заново.",
        404,
      );
    return s;
  };
  const stop = (s) => {
    s.state = "cancelled";
    s.abort.abort();
  };
  const prune = () => {
    for (const [key, at] of closed) if (now() - at > 60000) closed.delete(key);
    for (const [id, s] of sessions)
      if (
        now() - s.heartbeat > heartbeatMs ||
        now() - s.startedAt > lifetimeMs
      ) {
        stop(s);
        sessions.delete(id);
      }
    if (!sessions.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const pump = async () => {
    prune();
    const current = [...sessions.values()];
    const offset = current.length ? turn++ % current.length : 0;
    for (const s of [...current.slice(offset), ...current.slice(0, offset)]) {
      if (
        s.state !== "running" ||
        s.validating ||
        s.pending ||
        inflight >= maxConcurrent
      )
        continue;
      s.validating = true;
      try {
        await validate(s);
      } catch (error) {
        if (s.state === "running") {
          s.state = "failed";
          s.error = publicError(error);
        }
        continue;
      } finally {
        s.validating = false;
      }
      if (
        s.abort.signal.aborted ||
        s.state !== "running" ||
        !sessions.has(s.id)
      )
        continue;
      const gateway =
        s.transport === "mikrotik" ? String(s.mikrotikRecordId) : null;
      if (gateway && gateways.has(gateway)) continue;
      const count = Math.min(
        gateway ? 1 : 4,
        maxConcurrent - inflight,
        s.total - s.next,
      );
      for (let i = 0; i < count; i++) {
        const index = s.next++,
          host = s.addresses[Math.floor(index / s.ports.length)],
          targetPort = s.ports[index % s.ports.length];
        inflight++;
        s.pending++;
        if (gateway) gateways.add(gateway);
        Promise.resolve()
          .then(() =>
            probe(
              {
                host,
                port: targetPort,
                transport: s.transport,
                mikrotikRecordId: s.mikrotikRecordId,
              },
              "/",
              { probe: true, timeout: 5000, signal: s.abort.signal },
            ),
          )
          .then((reply) => {
            if (
              s.state === "running" &&
              !s.abort.signal.aborted &&
              /proxmox|pve-manager|pveproxy/i.test(reply.text)
            ) {
              if (s.candidates.length >= 1024) {
                s.resultsLimited = true;
                return;
              }
              s.candidates.push({
                id: `${host}:${targetPort}`,
                host,
                port: targetPort,
                transport: s.transport,
                mikrotikRecordId: s.mikrotikRecordId,
                fingerprint: reply.fingerprint,
                evidence:
                  "Обнаружен веб-интерфейс Proxmox; требуется проверка API",
                status: "candidate",
              });
            }
          })
          .catch((error) => {
            if (
              s.state === "running" &&
              String(error.code || "").startsWith("MIKROTIK_JUMP")
            ) {
              s.state = "failed";
              s.error = publicError(error);
              s.abort.abort();
            }
          })
          .finally(() => {
            inflight--;
            s.pending--;
            if (gateway) gateways.delete(gateway);
            if (s.state === "running") {
              s.cursor++;
              if (s.cursor === s.total) s.state = "completed";
            }
          });
      }
    }
  };
  const schedule = () => {
    if (autoSchedule && !timer) {
      timer = setInterval(() => {
        pump().catch(() => {});
      }, 250);
      timer.unref?.();
    }
  };
  return {
    async start(body, userId) {
      if (!body || typeof body !== "object" || Array.isArray(body))
        fail("Укажите параметры поиска");
      prune();
      const addresses = rangesToAddresses(body.ranges);
      if (body.ports !== undefined && !Array.isArray(body.ports))
        fail("Укажите список TCP-портов");
      const ports = [...new Set((body.ports || [8006]).map(port))];
      if (!ports.length || ports.length > 8) fail("Укажите от 1 до 8 портов");
      const transport = body.transport || "direct";
      if (!["direct", "mikrotik"].includes(transport))
        fail("Некорректный транспорт");
      if (
        transport === "mikrotik" &&
        !require("mongoose").isValidObjectId(body.mikrotikRecordId)
      )
        fail("Выберите устройство MikroTik");
      const id = body.clientSessionId || randomUUID();
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        fail("Некорректный идентификатор поиска");
      if (closed.has(`${userId}:${id}`)) fail("Поиск уже закрыт", 409);
      if (sessions.has(id)) fail("Поиск уже запущен", 409);
      const s = {
        id,
        userId: String(userId),
        transport,
        mikrotikRecordId:
          transport === "mikrotik" ? body.mikrotikRecordId : undefined,
        ranges: body.ranges.map(String),
        ports,
        addresses,
        total: addresses.length * ports.length,
        state: "running",
        next: 0,
        cursor: 0,
        pending: 0,
        validating: false,
        candidates: [],
        startedAt: now(),
        heartbeat: now(),
        abort: new AbortController(),
      };
      await validate(s);
      if (closed.has(`${userId}:${id}`)) fail("Поиск уже закрыт", 409);
      if (sessions.has(id)) fail("Поиск уже запущен", 409);
      for (const [id, previous] of sessions)
        if (previous.userId === s.userId) {
          stop(previous);
          sessions.delete(id);
        }
      if (sessions.size >= maxSessions)
        fail("Слишком много одновременных поисков. Повторите позже.", 429);
      sessions.set(s.id, s);
      schedule();
      return snapshot(s);
    },
    get(id, userId) {
      prune();
      const s = owned(id, userId);
      return validate(s).then(() => {
        if (!sessions.has(id))
          fail(
            "Поиск закрыт или срок ожидания истёк. Запустите поиск заново.",
            404,
          );
        s.heartbeat = now();
        return snapshot(s);
      });
    },
    cancel(id, userId) {
      prune();
      const s = owned(id, userId);
      stop(s);
      return validate(s).then(() => {
        s.heartbeat = now();
        return snapshot(s);
      });
    },
    close(id, userId) {
      if (!/^[0-9a-f-]{36}$/i.test(id))
        fail("Некорректный идентификатор поиска");
      prune();
      const s = sessions.get(id);
      if (s && s.userId !== String(userId)) fail("Поиск не найден", 404);
      if (s) stop(s);
      sessions.delete(id);
      closed.set(`${userId}:${id}`, now());
      if (closed.size > 256) closed.delete(closed.keys().next().value);
      prune();
    },
    pump,
    dispose() {
      for (const s of sessions.values()) stop(s);
      sessions.clear();
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
const sessions = createSessionManager();
const networks = async (id) => {
  const prefs = await require("../../models/preferences").findOne({}).lean();
  if (!prefs?.modules?.mikrotik?.isActive)
    fail("Модуль MikroTik выключен", 409);
  const record = await require("../../models/mikrotik").findById(id);
  if (!record || record.jumpRecordId || !record.monitoringEnabled)
    fail("Роутер недоступен", 409);
  const { pollParams } = require("../mikrotik/monitorState");
  const { withApiSession } = require("../mikrotik/connector");
  return withApiSession(pollParams(record), async ({ conn }) => {
    const addresses = await conn.write(["/ip/address/print"]);
    const routes = await conn.write(["/ip/route/print"]);
    const items = [];
    for (const a of addresses)
      if (a.disabled !== "true" && a.invalid !== "true")
        items.push({
          cidr: a.address,
          interface: a.interface,
          source: "connected",
        });
    for (const r of routes)
      if (
        r.active === "true" &&
        r.disabled !== "true" &&
        r.blackhole !== "true" &&
        r.unreachable !== "true" &&
        r["dst-address"] !== "0.0.0.0/0" &&
        (!r["routing-table"] || r["routing-table"] === "main")
      )
        items.push({
          cidr: r["dst-address"],
          gateway: r.gateway,
          source: "route",
        });
    return { items };
  });
};
module.exports = { ...sessions, networks, createSessionManager };

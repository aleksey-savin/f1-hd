const https = require("https");
const tls = require("tls");
const net = require("net");
const dns = require("dns").promises;
const { fail, safeIp, port } = require("./policy");
const { decryptSecret } = require("../crypto/secretBox");
const lanes = new Map();
const inLane = async (key, fn) => {
  const previous = lanes.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  lanes.set(key, run);
  try {
    return await run;
  } finally {
    if (lanes.get(key) === run) lanes.delete(key);
  }
};
const normalizeEndpoint = (input) => {
  const host = String(input?.host || "").trim();
  if (
    !host ||
    host.length > 253 ||
    /[\s/@?#\\]/.test(host) ||
    host.toLowerCase() === "localhost" ||
    (net.isIP(host) && !safeIp(host))
  )
    fail("Укажите допустимый адрес Proxmox");
  const transport = input.transport || "direct";
  if (!["direct", "mikrotik"].includes(transport))
    fail("Неизвестный способ подключения");
  const tlsMode = input.tlsMode || "system";
  if (!["system", "ca", "fingerprint", "insecure"].includes(tlsMode))
    fail("Неизвестный режим TLS");
  if (transport === "mikrotik" && !net.isIP(host))
    fail("Для туннеля укажите IP-адрес Proxmox");
  const fingerprint = String(input.fingerprint || "")
    .replace(/:/g, "")
    .toLowerCase();
  if (tlsMode === "fingerprint" && !/^[a-f0-9]{64}$/.test(fingerprint))
    fail("Укажите SHA-256 отпечаток сертификата");
  if (
    tlsMode === "ca" &&
    !String(input.caCert || "").includes("BEGIN CERTIFICATE")
  )
    fail("Укажите CA сертификат");
  return {
    transport,
    host,
    port: port(input.port || 8006),
    tlsMode,
    fingerprint,
    caCert: input.caCert || undefined,
    mikrotikRecordId:
      transport === "mikrotik" ? input.mikrotikRecordId : undefined,
  };
};
const withSocket = async (
  endpoint,
  fn,
  { probe = false, timeout = 15000, signal } = {},
) => {
  let ssh;
  let channel;
  let socket;
  let pendingSocket;
  const execute = async () => {
    const abort = () => {
      pendingSocket?.destroy(new Error("Поиск остановлен"));
      socket?.destroy(new Error("Поиск остановлен"));
      channel?.destroy();
      ssh?.conn.end();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      let host = endpoint.host;
      if (endpoint.transport === "mikrotik") {
        const prefs = await require("../../models/preferences")
          .findOne({})
          .lean();
        if (!prefs?.modules?.mikrotik?.isActive)
          fail("Модуль MikroTik выключен", 409);
        const record = await require("../../models/mikrotik").findById(
          endpoint.mikrotikRecordId,
        );
        if (!record || !record.monitoringEnabled || record.jumpRecordId)
          fail(
            "Транзитный MikroTik недоступен или сам использует транзит",
            409,
          );
        const connector = require("../mikrotik/connector");
        ssh = await connector.openJumpConnection(
          connector.buildSshParams(record),
          { priority: probe ? -1 : 0 },
        );
        signal?.throwIfAborted();
        channel = await connector.openForwardChannel(
          ssh.conn,
          host,
          endpoint.port,
        );
      } else {
        const ips = net.isIP(host)
          ? [{ address: host }]
          : await dns.lookup(host, { all: true });
        if (!ips.length || ips.some(({ address }) => !safeIp(address)))
          fail("Недопустимый адрес подключения");
        host = ips[0].address;
      }
      signal?.throwIfAborted();
      socket = await new Promise((resolve, reject) => {
        const s = tls.connect({
          ...(channel ? { socket: channel } : { host, port: endpoint.port }),
          servername: net.isIP(endpoint.host) ? undefined : endpoint.host,
          ca: endpoint.tlsMode === "ca" ? endpoint.caCert : undefined,
          rejectUnauthorized:
            !probe && !["fingerprint", "insecure"].includes(endpoint.tlsMode),
          checkServerIdentity: (_host, cert) =>
            tls.checkServerIdentity(endpoint.host, cert),
        });
        pendingSocket = s;
        const handshakeDeadline = setTimeout(
          () => s.destroy(new Error("Истекло время TLS соединения")),
          timeout,
        );
        s.once("close", () => clearTimeout(handshakeDeadline));
        s.once("secureConnect", () => clearTimeout(handshakeDeadline));
        s.setTimeout(timeout, () =>
          s.destroy(new Error("Истекло время подключения")),
        );
        s.once("error", reject);
        s.once("secureConnect", () => {
          const fingerprint = s
            .getPeerCertificate()
            .fingerprint256?.replace(/:/g, "")
            .toLowerCase();
          if (
            !probe &&
            endpoint.tlsMode === "fingerprint" &&
            fingerprint !== endpoint.fingerprint
          ) {
            s.destroy();
            return reject(new Error("Отпечаток TLS сертификата изменился"));
          }
          resolve(s);
        });
      });
      return await fn(socket);
    } finally {
      signal?.removeEventListener("abort", abort);
      pendingSocket?.destroy();
      socket?.destroy();
      channel?.destroy();
      ssh?.conn.end();
    }
  };
  return endpoint.transport === "mikrotik"
    ? inLane(String(endpoint.mikrotikRecordId), execute)
    : execute();
};
const requestEndpoint = (
  endpoint,
  path,
  {
    method = "GET",
    tokenId,
    tokenSecret,
    body,
    json = false,
    probe = false,
    timeout = 15000,
    signal,
  } = {},
) =>
  withSocket(
    endpoint,
    (socket) =>
      new Promise((resolve, reject) => {
        const payload = body
          ? json ? JSON.stringify(body) : new URLSearchParams(
              Object.entries(body)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)]),
            ).toString()
          : null;
        const fingerprint = socket.getPeerCertificate().fingerprint256;
        const req = https.request(
          {
            hostname: endpoint.host,
            port: endpoint.port,
            path,
            method,
            createConnection: () => socket,
            headers: {
              Accept: "application/json",
              ...(tokenId
                ? { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` }
                : {}),
              ...(payload
                ? {
                    "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded",
                    "Content-Length": Buffer.byteLength(payload),
                  }
                : {}),
            },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
              if (data.length > 4 * 1024 * 1024)
                req.destroy(new Error("Слишком большой ответ API"));
            });
            res.on("end", () => {
              if (probe)
                return resolve({
                  status: res.statusCode,
                  text: data.slice(0, 100000),
                  fingerprint,
                });
              if (res.statusCode < 200 || res.statusCode >= 300) {
                // A PVE token refusal is a connection failure, not an expired
                // HD session: forwarding 401 signs the operator out of HD.
                const denied = res.statusCode === 401 || res.statusCode === 403;
                const err = new Error(
                  denied
                    ? `API Proxmox отклонил токен или права доступа (HTTP ${res.statusCode}). Проверьте ID и секрет API-токена, права пользователя и самого токена (Privilege Separation).`
                    : `API Proxmox: HTTP ${res.statusCode}`,
                );
                err.statusCode = denied ? 502 : res.statusCode;
                return reject(err);
              }
              try {
                resolve(JSON.parse(data).data);
              } catch {
                reject(new Error("Некорректный ответ API Proxmox"));
              }
            });
            res.on("error", reject);
          },
        );
        const deadline = setTimeout(
          () => req.destroy(new Error("Истекло время запроса API")),
          timeout,
        );
        req.once("close", () => clearTimeout(deadline));
        req.setTimeout(timeout, () =>
          req.destroy(new Error("Истекло время запроса API")),
        );
        req.on("error", reject);
        req.end(payload);
      }),
    { probe, timeout, signal },
  );
const request = async (connection, path, options = {}) => {
  const endpoints = connection.endpoints || [];
  let last;
  for (const endpoint of endpoints) {
    try {
      return await requestEndpoint(endpoint, `/api2/json${path}`, {
        ...options,
        tokenId: connection.tokenId,
        tokenSecret: decryptSecret(connection.tokenSecret),
      });
    } catch (error) {
      last = error;
      if (options.method && options.method !== "GET") throw error;
    }
  }
  throw last || new Error("Не настроено подключение");
};
module.exports = {
  normalizeEndpoint,
  requestEndpoint,
  request,
  withSocket,
  inLane,
};

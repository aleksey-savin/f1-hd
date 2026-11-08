// Opt-in, synthetic-only rehearsal. No app.js, dotenv, existing DB or containers.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const BASELINE = "/tmp/hd-w5a-baseline";
const PASSWORD = "synthetic-w5a-password-123";
const SERVICE_TOKEN = "synthetic-w5a-service-only";
// Lazy reuse keeps Task1's unchanged fixture from reading config before the
// synthetic environment is installed.
const cookieFrom = (response) => require("./browserSession.fixture.cjs").cookieFrom(response);

async function rehearsal(t) {
  assert.equal(process.env.W5A_REHEARSAL, "1", "explicit opt-in required");
  // Discard inherited deployment settings BEFORE loading application modules.
  for (const key of Object.keys(process.env)) {
    if (/^(?:MONGODB_|S3_|TG_|BETTER_AUTH_|APP_|MAIL_|ADDRESS$|CORS_|ADD_TICKET_LOG$|MIKROTIK_ARTIFACTS_DIR$)/.test(key)) delete process.env[key];
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-w5a-"));
  const name = `codex-w5a-mongo-${randomUUID()}`;
  t.diagnostic(`synthetic fixture container: ${name}; scratch: ${directory}`);
  const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 45000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const previousCwd = process.cwd();
  let mongoStarted = false, server, mongoose, browser;
  t.after(async () => {
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose?.disconnect();
    if (mongoStarted) docker("rm", "--force", name);
    process.chdir(previousCwd);
    await fs.rm(directory, { recursive: true, force: true });
  });
  // --pull=never: missing images fail, never install/download anything.
  docker("run", "--detach", "--pull=never", "--name", name,
    "--label", "codex.w5a.fixture=true", "--ulimit", "core=0",
    "--publish", "127.0.0.1::27017", "--tmpfs", "/data/db", "--tmpfs", "/data/configdb",
    "mongo:8", "--bind_ip_all");
  mongoStarted = true;
  const port = docker("port", name, "27017/tcp").match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  assert.ok(port, "Mongo must publish ONLY on loopback");

  const backend = path.resolve(__dirname, "../..");
  const root = path.resolve(backend, "..");
  // All writes go to scratch; the baseline snapshot remains read-only.
  await fs.mkdir(path.join(directory, "old", "backend", "auth"), { recursive: true });
  await fs.copyFile(path.join(BASELINE, "backend/auth/instance.mjs"), path.join(directory, "old/backend/auth/instance.mjs"));
  await fs.symlink(path.join(backend, "node_modules"), path.join(directory, "old/backend/node_modules"));
  await fs.mkdir(path.join(directory, "old/backend/controllers"));
  for (const file of ["auth", "me"]) {
    await fs.copyFile(path.join(BASELINE, `backend/controllers/${file}.js`), path.join(directory, `old/backend/controllers/${file}.js`));
  }
  for (const folder of ["models", "services", "middleware"]) {
    await fs.symlink(path.join(backend, folder), path.join(directory, "old/backend", folder));
  }
  await fs.symlink(path.join(backend, "auth/bootstrap.js"), path.join(directory, "old/backend/auth/bootstrap.js"));
  await fs.copyFile(path.join(BASELINE, "backend/middleware/attachSession.js"), path.join(directory, "old/attachSession.cjs"));
  await fs.mkdir(path.join(directory, "uploads"));
  // storage.js deliberately uses cwd/uploads; do not create real dev uploads.
  process.chdir(directory);
  Object.assign(process.env, {
    NODE_ENV: "production", MAIL_MODE: "off", TG_API_TOKEN: SERVICE_TOKEN,
    VITE_API_ADDRESS: "", APP_VERSION: "dev", APP_COMMIT: "dev", TRUST_PROXY_HOPS: "0",
    BETTER_AUTH_SECRET: "synthetic-w5a-unchanged-secret-at-least-thirty-two-characters",
    UPLOADS_DIR: path.join(directory, "uploads"),
    MIKROTIK_ARTIFACTS_DIR: path.join(directory, "artifacts"),
  });
  require("module-alias").addAlias("@", backend);
  mongoose = require("mongoose");
  mongoose.set("autoIndex", false);
  await mongoose.connect(`mongodb://127.0.0.1:${port}/codex_w5a_synthetic`, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const express = require("express");
  const app = express();
  app.set("trust proxy", 0);
  const renewalControls = new Map();
  app.use((req, res, next) => {
    const control = renewalControls.get(req.get("x-codex-w5a-withhold"));
    if (!control || req.method !== "GET" || req.path !== "/api/me") return next();
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (field, value) => {
      if (field.toLowerCase() !== "set-cookie") return setHeader(field, value);
      const retained = (Array.isArray(value) ? value : [value]).filter((line) => {
        if (!String(line).startsWith("hd.session_token=")) return true;
        control.suppressed++;
        return false;
      });
      if (retained.length) return setHeader(field, retained);
      res.removeHeader(field);
      return res;
    };
    next();
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_PUBLIC_URL = origin;
  process.env.ADDRESS = origin;
  const realFetch = global.fetch;
  global.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.equal(new URL(url).origin, origin, "fixture fetch must never reach an existing deployment or external API");
    return realFetch(input, init);
  };
  t.after(() => { global.fetch = realFetch; });
  const config = { ...require("../config"), baseURL: origin, trustedOrigins: [origin] };
  const candidate = await import("../instance.mjs");
  const oldModule = await import(pathToFileURL(path.join(directory, "old/backend/auth/instance.mjs")));
  const options = {
    db, client: mongoose.connection.getClient(), config,
    statement: require("../access").STATEMENT,
    // Only outbound effects are replaced. Account refusal remains production.
    hooks: { ...require("../hooks"), checkPasswordBreach: async () => ({ breached: false }),
      sendEmailCode: async () => { throw new Error("unexpected mail"); },
      sendMagicLink: async () => { throw new Error("unexpected mail"); },
      sendResetPassword: async () => { throw new Error("unexpected mail"); } },
  };
  const old = oldModule.createAuth(options), current = candidate.createAuth(options);
  await Promise.all([old.$context, current.$context]);
  let mode = "old", frontendMode = "old";
  const active = () => mode === "old" ? old : current;
  // Test-local bridge only; real middleware/controllers/policies below.
  Object.assign(require("../bootstrap"), {
    getAuth: active, getFromNodeHeaders: () => candidate.fromNodeHeaders,
    authorizeFor: candidate.authorizeFor,
  });
  const { browserOrigin } = require("../../middleware/browserOrigin");
  const guard = browserOrigin({ publicUrl: origin });
  const { authPathAllowList } = require("../../middleware/authPathAllowList");
  const { authBodyLimit, getAuthBodyRequest } = require("../../middleware/authBodyLimit");
  app.all("/api/auth/{*path}", authPathAllowList, guard, authBodyLimit(), (req, res) => {
    const request = getAuthBodyRequest(req, res);
    if (request !== req) request.ip = req.ip; // same Task5 replay bridge as bootstrap
    return (mode === "old" ? oldModule.toNodeHandler(old) : candidate.toNodeHandler(current))(request, res);
  });
  app.use(guard);
  app.use(express.json({ limit: "100kb" }));
  // Service router terminates before browser attachSession, as in routes/index.
  app.use("/api/bot", require("../../routes/bot"));
  const { bus } = require("../../services/pulse");
  app.use("/api", (_req, res, next) => { res.set("X-Pulse-Cursor", bus.cursor()); next(); });
  const oldAttach = require(path.join(directory, "old/attachSession.cjs"));
  const newAttach = require("../../middleware/attachSession");
  app.use("/api", (req, res, next) => (mode === "old" ? oldAttach : newAttach)(req, res, next));
  const oldLogin = require(path.join(directory, "old/backend/controllers/auth.js")).login;
  const oldMe = require(path.join(directory, "old/backend/controllers/me.js")).getMe;
  const requireAuth = require("../../middleware/requireAuth");
  app.post("/api/login", (req, res, next) => mode === "old" ? oldLogin(req, res, next) : next());
  app.get("/api/me", requireAuth, (req, res, next) => mode === "old" ? oldMe(req, res, next) : next());
  for (const route of ["appVersion", "me", "auth", "ticket", "comment", "pulse", "preferences", "notification", "formData", "ticketTemplate", "myWorkplace"]) {
    app.use("/api", require(`../../routes/internal/${route}`));
  }
  app.use("/uploads", express.static(path.join(directory, "uploads")));
  app.get("/__tests__/w5a-cookie-renewal", (_req, res) => res.type("html").send("<!doctype html><title>Synthetic cookie renewal</title>"));
  app.use((error, _req, res, _next) => {
    t.diagnostic(`fixture HTTP error: ${error.originalError?.message || error.message}`);
    res.status(error.statusCode || 500).json({ message: error.message });
  });
  app.use("/api", (_req, res) => res.status(404).json({ message: "Route outside the scoped rehearsal" }));

  const companyId = new mongoose.Types.ObjectId();
  await db.collection("companies").insertOne({ _id: companyId, fullTitle: "Synthetic company", alias: "SYN", isActive: true });
  const Preferences = require("../../models/preferences");
  const prefs = new Preferences({ timezone: "Asia/Vladivostok", ai: { isActive: false },
    notify: { byTelegram: { isActive: true }, personal: { newTicket: true } } });
  await prefs.save();
  const ctx = await old.$context;
  const users = [];
  for (const [label, audience] of [["client", true], ["client-manager", true], ["client-admin", true], ["missing", undefined], ["null", null], ["staff", false]]) {
    const user = await ctx.internalAdapter.createUser({ name: label, email: `${label}@example.test`, emailVerified: true, role: "user" });
    await ctx.internalAdapter.createAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: require("bcryptjs").hashSync(PASSWORD, 4) });
    const fields = { firstName: label, lastName: "Synthetic", company: { _id: companyId, alias: "SYN", isActive: true },
      notify: { byTelegram: { newTicket: true } },
      ...(audience === undefined ? {} : { isEndUser: audience }),
      ...(label === "client" ? { telegramBot: { isActive: true, chatId: "123456789" } } : {}) };
    await db.collection("users").updateOne({ _id: new mongoose.Types.ObjectId(user.id) }, { $set: fields });
    users.push({ ...user, label });
  }
  // Explicit client roles exercise the real membership/permission lookup.
  const orgId = new mongoose.Types.ObjectId();
  await db.collection("organization").insertOne({ _id: orgId, name: "Synthetic", slug: "hd" });
  for (const label of ["client-manager", "client-admin"]) {
    const user = users.find((row) => row.label === label);
    await db.collection("member").insertOne({ organizationId: String(orgId), userId: user.id, role: label, createdAt: new Date() });
    await db.collection("organizationRole").insertOne({ organizationId: String(orgId), role: label,
      permission: JSON.stringify({ ticket: ["createForOthers", "readCompany"] }) });
  }
  const send = (url, { cookie, authorization, body, method = body === undefined ? "GET" : "POST", headers = {} } = {}) => fetch(`${origin}${url}`, {
    method, headers: { origin, ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}),
      ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), ...headers },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  const loginOld = async (user) => {
    const response = await old.api.signInEmail({ body: { email: user.email, password: PASSWORD }, asResponse: true });
    assert.equal(response.status, 200);
    const cookie = cookieFrom(response);
    const session = await old.api.getSession({ headers: new Headers({ cookie }) });
    assert.ok(session?.session?.token, "old library must issue a real credential");
    return { cookie, session: session.session, payload: await response.json() };
  };
  return {
    origin, root, directory, db, users, old, current, ctx, send, loginOld, cookieFrom,
    switchBackend: (value) => { assert.ok(["old", "candidate"].includes(value)); mode = value; },
    switchFrontend: (value) => { frontendMode = value; },
    withholdRenewalCookies() {
      const id = randomUUID();
      const stats = { suppressed: 0 };
      renewalControls.set(id, stats);
      return { headers: { "x-codex-w5a-withhold": id }, stats, release: () => renewalControls.delete(id) };
    },
    async browser() {
      const frontend = path.join(root, "frontend");
      const oldFrontend = path.join(directory, "old/frontend");
      const newFrontend = path.join(directory, "candidate/frontend");
      const { build } = await import(pathToFileURL(path.join(frontend, "node_modules/vite/dist/node/index.js")));
      for (const [source, folder, candidateBundle] of [[path.join(BASELINE, "frontend"), oldFrontend, false], [frontend, newFrontend, true]]) {
        await fs.cp(source, folder, { recursive: true,
          filter: (src) => !path.basename(src).startsWith(".env") && !["node_modules", "dist", ".git"].includes(path.basename(src)) });
        await fs.symlink(path.join(frontend, "node_modules"), path.join(folder, "node_modules"));
        // Add a test-only entry to the SCRATCH copy. Rollup shares these actual
        // application modules with the unmodified app entry; no selector model.
        await fs.writeFile(path.join(folder, "w5a-entry.js"), [
          'import * as api from "./src/lib/api.ts";',
          'import * as cache from "./src/store/form-data.ts";',
          'import * as auth from "./src/pages/Auth/session.ts";',
          ...(candidateBundle ? ['import * as session from "./src/util/browser-session.js";'] : []),
          `window.w5aModules = { api, cache, auth${candidateBundle ? ", session" : ""} };`,
        ].join("\n"));
        const html = await fs.readFile(path.join(folder, "index.html"), "utf8");
        await fs.writeFile(path.join(folder, "index.html"), html.replace("</body>", '<script type="module" src="/w5a-entry.js"></script></body>'));
        await build({ root: folder, configFile: path.join(folder, "vite.config.js"), envFile: false,
          cacheDir: path.join(directory, candidateBundle ? "vite-new" : "vite-old"), logLevel: "error",
          build: { outDir: path.join(folder, "dist"), emptyOutDir: true } });
      }
      const staticOld = express.static(path.join(oldFrontend, "dist"));
      const staticNew = express.static(path.join(newFrontend, "dist"));
      app.use((req, res, next) => (frontendMode === "old" ? staticOld : staticNew)(req, res, next));
      // Keep preceding chunks available to tabs already loaded before a switch.
      app.use((req, res, next) => (frontendMode === "old" ? staticNew : staticOld)(req, res, next));
      app.use((_req, res) => res.sendFile(path.join(frontendMode === "old" ? oldFrontend : newFrontend, "dist/index.html")));
      const { chromium } = require(path.join(frontend, "node_modules/playwright"));
      browser = await chromium.launch({ headless: true });
      return browser;
    },
    async oldBot() {
      const folder = path.join(directory, "old/tg-service");
      await fs.cp(path.join(BASELINE, "tg-service"), folder, { recursive: true,
        filter: (src) => !path.basename(src).startsWith(".env") && !["node_modules", "data", "logs"].includes(path.basename(src)) });
      await fs.symlink(path.join(root, "tg-service/node_modules"), path.join(folder, "node_modules"));
      Object.assign(process.env, { TG_TOKEN: "123456:synthetic-never-delivered", TG_API_TOKEN: SERVICE_TOKEN,
        BACKEND_URL: origin, TG_DB_PATH: path.join(directory, "bot.sqlite"), ADDRESS: origin });
      const database = await import(pathToFileURL(path.join(folder, "src/store/db.ts")));
      database.openDatabase();
      t.after(() => database.closeDatabase());
      const { createBot } = await import(pathToFileURL(path.join(folder, "src/bot/index.ts")));
      const { runOutboxCycle } = await import(pathToFileURL(path.join(folder, "src/workers/outbox.ts")));
      return { createBot, runOutboxCycle };
    },
  };
}

module.exports = { rehearsal, PASSWORD, SERVICE_TOKEN, cookieFrom };

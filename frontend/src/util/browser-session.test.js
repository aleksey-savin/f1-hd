import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Run the real frontend modules; substitute only browser IO.
const root = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    const url = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), root)
      : specifier.startsWith(".") && context.parentURL?.startsWith(root.href)
        ? new URL(specifier, context.parentURL)
        : null;
    if (url)
      for (const suffix of ["", ".js", ".ts", ".jsx", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + suffix))
          return next(
            pathToFileURL(fileURLToPath(url) + suffix).href + url.search,
            context,
          );
      }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(root.href) && /\.(ts|tsx|jsx|js)(?:\?.*)?$/.test(url)) {
      const source = readFileSync(fileURLToPath(url), "utf8").replaceAll(
        "import.meta.env.VITE_API_ADDRESS",
        '""',
      );
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(source, {
          fileName: fileURLToPath(url),
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    }
    return next(url, context);
  },
});
class Storage {
  values = new Map();
  get length() {
    return this.values.size;
  }
  key(i) {
    return [...this.values.keys()][i] ?? null;
  }
  getItem(k) {
    return this.values.get(k) ?? null;
  }
  setItem(k, v) {
    this.values.set(k, String(v));
  }
  removeItem(k) {
    this.values.delete(k);
  }
  clear() {
    this.values.clear();
  }
}
globalThis.localStorage = new Storage();
globalThis.window = new EventTarget();
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
};
document.documentElement = { ownerDocument: document };
const { api, ApiError, setUnauthorizedHandler } = await import("../lib/api.ts");
const {
  authDataLoader,
  getLocalStorageData,
  logoutLoader,
  loadBrowserIdentity,
  refreshAuthData,
} = await import("./auth.js");
const { storeSession, clearSession } = await import("../pages/Auth/session.ts");
const forms = await import("../store/form-data.ts");
const { redirect } = await import("react-router");
const session = await import("./browser-session.js");
const { adoptBrand } = await import("../store/prefs.js");
const { readCachedBrand } = await import("./brand.js");
const { FALLBACK_PREFS } = await import("../pages/Auth/prefs.ts");
const React = await import("react");
// Route modules also import visual components. Execute the actual loader AST
// independently of those components; retain the real API/cache dependencies.
function routeLoader(path, bindings = {}) {
  const file = ts.createSourceFile(
    path,
    readFileSync(new URL(path, root), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const loader = file.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "loader",
  );
  const source = ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Unspecified, loader, file)
    .replace(/^export /, "")
    .replaceAll("import.meta.env.VITE_API_ADDRESS", '""');
  const constants = file.statements
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          (decl) => decl.name.getText(file) === "LEGACY_MODES",
        ),
    )
    .map((node) =>
      ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, file),
    )
    .join("\n");
  const deps = {
    api,
    ApiError,
    load: forms.load,
    redirect,
    getLocalStorageData,
    setDocTitle: () => {},
    API: "",
    confirmBrowserSession: session.confirmBrowserSession,
    loadBrowserIdentity,
    browserSessionGeneration: session.browserSessionGeneration,
    assertBrowserSessionCurrent: session.assertBrowserSessionCurrent,
    adoptBrand,
    readCachedBrand,
    FALLBACK_PREFS,
    ...bindings,
  };
  return new Function(
    ...Object.keys(deps),
    `${ts.transpile(constants + source, { target: ts.ScriptTarget.ES2022 })}; return loader;`,
  )(...Object.values(deps));
}
const me = (id = "alice", sessionId = "s1") => ({
  user: { _id: id },
  sessionId,
  prefs: {},
  modules: {},
});
const json = (body, status = 200) => Response.json(body, { status });
function setup() {
  clearSession();
  localStorage.clear();
  forms.invalidate();
}

test("cookie bootstrap replaces credential without extending stale expiry or posting logout; Pulse has no bearer", async () => {
  setup();
  localStorage.setItem("expiryDate", "2001-01-01T00:00:00.000Z");
  localStorage.setItem("token", "readable-credential");
  const requests = [];
  globalThis.fetch = async (url, opts) => {
    requests.push([url, opts]);
    return json(url === "/api/me" ? me() : {});
  };
  assert.equal((await authDataLoader()).userData._id, "alice");
  await api("/api/pulse");
  assert.ok(requests.every(([, opts]) => !opts?.headers?.Authorization));
  assert.ok(requests.every(([url]) => url !== "/api/logout"));
  assert.equal(localStorage.getItem("token"), "cookie.s1");
  assert.equal(localStorage.getItem("expiryDate"), "2001-01-01T00:00:00.000Z");
});
test("missing storage credentials still bootstrap confirmed cookie identity", async () => {
  setup();
  globalThis.fetch = async (url) => json(url === "/api/me" ? me() : {});
  assert.equal((await authDataLoader()).sessionId, "s1");
  assert.equal(localStorage.getItem("token"), "cookie.s1");
  assert.equal(localStorage.getItem("userId"), "alice");
});
test("timezone metadata is readable without auth keys and with stale expiry", () => {
  setup();
  localStorage.setItem("timezone", "Asia/Vladivostok");
  assert.equal(getLocalStorageData().timezone, "Asia/Vladivostok");
  localStorage.setItem("token", "cookie.s1");
  localStorage.setItem("expiryDate", "2001-01-01");
  assert.equal(getLocalStorageData().timezone, "Asia/Vladivostok");
});
test("only 401 clears state; refusals, rate limits, outages and network failures retain it", async () => {
  for (const status of [403, 429, 500, 502, 503, "network", 401]) {
    setup();
    localStorage.setItem("token", "cookie.s1");
    globalThis.fetch = async () => {
      if (status === "network") throw new TypeError("Failed to fetch");
      return json({}, status);
    };
    await assert.rejects(
      api("/api/me"),
      status === "network" ? TypeError : ApiError,
    );
    assert.equal(
      localStorage.getItem("token"),
      status === 401 ? null : "cookie.s1",
    );
  }
});
test("login consumes marker response, ignoring credential header; old tab retains nonsecret per-session metadata", async () => {
  setup();
  globalThis.fetch = async () => json({ timezone: "Asia/Vladivostok" });
  await storeSession(
    { token: "cookie.s1", expiryDate: "2030-01-01", userId: "alice" },
    new Response(null, { headers: { "set-auth-token": "secret" } }),
  );
  assert.equal(localStorage.getItem("token"), "cookie.s1");
  assert.equal(localStorage.getItem("expiryDate"), "2030-01-01T00:00:00.000Z");
  assert.equal(localStorage.getItem("userId"), "alice");
  // Installed old storeSession/header contract consumes the same HTTP body.
  const old = new Storage();
  const body = { token: "cookie.s2", expiryDate: "2030-01-01", userId: "bob" };
  old.setItem("token", body.token);
  old.setItem("expiryDate", new Date(body.expiryDate).toISOString());
  old.setItem("userId", body.userId);
  assert.equal(`Bearer ${old.getItem("token")}`, "Bearer cookie.s2");
  assert.notEqual(old.getItem("token"), localStorage.getItem("token"));
});
test("form caches isolate confirmed account/session, shared storage tampering and late logout responses", async () => {
  setup();
  let identity = me();
  let calls = 0;
  globalThis.fetch = async (url) =>
    json(
      url === "/api/me"
        ? identity
        : url === "/api/form-data"
          ? { account: identity.user._id, call: ++calls }
          : {},
    );
  await authDataLoader();
  assert.deepEqual(await forms.load("/api/form-data"), {
    account: "alice",
    call: 1,
  });
  localStorage.setItem("token", "other-tab-marker");
  assert.equal((await forms.load("/api/form-data")).call, 2);
  identity = me("bob", "s2");
  await authDataLoader();
  assert.deepEqual(await forms.load("/api/form-data"), {
    account: "bob",
    call: 3,
  });
  identity = me("bob", "s3");
  await authDataLoader();
  assert.equal((await forms.load("/api/form-data")).call, 4);
  let finish;
  const normal = globalThis.fetch;
  globalThis.fetch = (url, opts) =>
    url === "/api/late"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : normal(url, opts);
  const pending = forms.load("/api/late");
  await logoutLoader();
  finish(json({ account: "bob" }));
  await assert.rejects(pending, (error) => error.name === "AbortError");
  await authDataLoader();
  globalThis.fetch = async () => json({ account: "fresh" });
  assert.deepEqual(await forms.load("/api/late"), { account: "fresh" });
});

test("Dashboard and user loaders do not reject cookie sessions with no storage keys", async () => {
  setup();
  globalThis.fetch = async (url) => json(url === "/api/me" ? me() : {});
  assert.equal(await routeLoader("pages/Dashboard.jsx")(), null);
  for (const path of ["Add", "Update", "View"]) {
    const result = await routeLoader(`pages/User/${path}.jsx`)({
      params: { id: "alice" },
    });
    assert.ok(
      !(result instanceof Response),
      `${path} redirected a valid cookie session`,
    );
  }
});

test("MyAccount asks server for own user instead of shared storage userId", async () => {
  setup();
  localStorage.setItem("userId", "another-account");
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return json(
      url === "/api/me"
        ? me()
        : url === "/api/users/alice"
          ? {
              _id: "alice",
              workSchedules: ["schedule-1"],
              getScreen: { hasApi: true },
            }
          : {},
    );
  };
  const result = await routeLoader("pages/User/MyAccount.jsx")();
  assert.equal(result.user._id, "alice");
  assert.deepEqual(result.user.workSchedules, ["schedule-1"]);
  assert.deepEqual(result.user.getScreen, { hasApi: true });
  assert.ok(requests.includes("/api/me"));
  assert.ok(!requests.some((url) => url.includes("another-account")));
});

test("auth redirect confirms cookies; 401 opens login while other failures preserve state", async () => {
  for (const status of [200, 401, 403, 429, 500, "network"]) {
    setup();
    localStorage.setItem("token", "old-tab-value");
    globalThis.fetch = async (url) => {
      if (url !== "/api/me") return json({});
      if (status === "network") throw new TypeError("Failed to fetch");
      return json(status === 200 ? me() : {}, status);
    };
    const loader = routeLoader("pages/Auth/Layout.tsx");
    const run = () =>
      loader({ request: new Request("https://example.test/auth") });
    if (status === 200) {
      assert.equal((await run()).headers.get("Location"), "/dashboard");
      assert.equal(localStorage.getItem("token"), "cookie.s1");
    } else if (status === 401) {
      assert.equal((await run()).emailIsActive, false);
      assert.equal(localStorage.getItem("token"), null);
    } else {
      await assert.rejects(run());
      assert.equal(localStorage.getItem("token"), "old-tab-value");
    }
  }
});

// Exercise the shell's returned React tree and effects. Visual children are
// opaque element types; only router/browser/store inputs are supplied.
function shellTree(data) {
  const path = "layout/Root.jsx";
  const file = ts.createSourceFile(
    path,
    readFileSync(new URL(path, root), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const node = file.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (decl) => decl.name.getText(file) === "RootLayout",
      ),
  );
  const deps = {};
  for (const statement of file.statements.filter(ts.isImportDeclaration)) {
    const clause = statement.importClause;
    if (clause?.name) deps[clause.name.text] = clause.name.text;
    for (const binding of clause?.namedBindings?.elements ?? [])
      deps[binding.name.text] = binding.name.text;
  }
  const effects = [];
  const submissions = [];
  const timers = [];
  Object.assign(deps, {
    React,
    getLocalStorageData,
    getTokenDuration: () => -1,
    setTimeout: (callback, delay) => {
      timers.push(delay);
      callback();
    },
    useEffect: (fn) => effects.push(fn),
    useLayoutEffect: (fn) => effects.push(fn),
    useRef: () => ({ current: null }),
    useState: (value) => [value, () => {}],
    useContext: () => ({ plainCanvas: false }),
    useLocation: () => ({ pathname: "/dashboard" }),
    useLoaderData: () => data,
    useMatches: () => [],
    useNavigate: () => () => {},
    useNavigation: () => ({ state: "idle" }),
    useSubmit:
      () =>
      (...args) =>
        submissions.push(args),
    useShallow: (fn) => fn,
    usePulseStore: (fn) => fn({}),
    useWorkStatusesStore: (fn) => fn({ users: [], railOpen: false }),
    useInitialPrefsStore: () => ({ set() {} }),
    useRouteErrorStore: (fn) => fn({ active: false }),
    useNavWait: () => {},
    layoutPathname: () => "/dashboard",
    resolveSheetWidth: () => 944,
    newerWorkStatus: () => null,
    cn: (...args) => args.filter(Boolean).join(" "),
    defaultAuthedUser: { statements: {}, permissionCatalogue: [] },
    AuthedUserContext: { Provider: "UserProvider" },
  });
  const source = ts
    .createPrinter()
    .printNode(ts.EmitHint.Unspecified, node, file)
    .replaceAll("import.meta.env.VITE_VERSION", '"dev"')
    .replaceAll("import.meta.env.VITE_API_ADDRESS", '""');
  const code = ts.transpile(source, {
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
  });
  const render = new Function(
    ...Object.keys(deps),
    `${code}; return RootLayout;`,
  )(...Object.values(deps));
  const tree = render();
  effects.forEach((fn) => fn());
  const types = [];
  function walk(element) {
    if (!element || typeof element !== "object") return;
    if (Array.isArray(element)) return element.forEach(walk);
    types.push(element.type);
    walk(element.props?.children);
  }
  walk(tree);
  return { types, timers, submissions };
}

test("confirmed shell mounts Pulse and both navigation shells without storage and never schedules expiry logout", () => {
  for (const stale of [false, true]) {
    setup();
    if (stale) {
      localStorage.setItem("token", "cookie.s1");
      localStorage.setItem("expiryDate", "2001-01-01");
    }
    const shell = shellTree({
      userData: { _id: "alice" },
      prefs: {},
      appVersion: "dev",
    });
    assert.ok(shell.types.includes("PulseLoop"));
    assert.ok(shell.types.includes("NavigationBar"));
    assert.ok(shell.types.includes("MobileBottomNavbar"));
    assert.deepEqual(shell.timers, []);
    assert.deepEqual(shell.submissions, []);
  }
});

test("parallel child loader cannot reuse previous account cache while root confirms changed cookies", async () => {
  setup();
  globalThis.fetch = async (url) =>
    json(url === "/api/me" ? me() : { account: "alice" });
  await authDataLoader();
  await forms.load("/api/form-data");
  let finish;
  globalThis.fetch = async (url) =>
    url === "/api/me"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : json({ account: "bob" });
  const rootLoad = authDataLoader();
  const child = await forms.load("/api/form-data");
  finish(json(me("bob", "s2")));
  await rootLoad;
  assert.deepEqual(child, { account: "bob" });
});

test("failed identity revalidation retains confirmed caches and releases the pending check", async () => {
  for (const status of [403, 429, 500, "network"]) {
    setup();
    globalThis.fetch = async (url) =>
      json(url === "/api/me" ? me() : { account: "alice" });
    await authDataLoader();
    await forms.load("/api/form-data");
    globalThis.fetch = async (url) => {
      if (url === "/api/me") {
        if (status === "network") throw new TypeError("Failed to fetch");
        return json({}, status);
      }
      return json({ account: "unexpected-refetch" });
    };
    await assert.rejects(authDataLoader());
    assert.equal(session.checkingBrowserSession(), false);
    assert.equal(session.confirmedUserId(), "alice");
    assert.equal(localStorage.getItem("token"), "cookie.s1");
    assert.deepEqual(await forms.load("/api/form-data"), { account: "alice" });
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const aborted = (error) => error.name === "AbortError";

test("obsolete Alice root success cannot overwrite newer Bob identity or return Alice loader data", async () => {
  setup();
  const alice = deferred();
  let count = 0;
  globalThis.fetch = async (url) =>
    url === "/api/me"
      ? ++count === 1
        ? alice.promise
        : json(me("bob", "bob-session"))
      : json({});
  const old = authDataLoader();
  assert.equal((await authDataLoader()).userData._id, "bob");
  alice.resolve(json(me("alice", "alice-session")));
  await assert.rejects(old, aborted);
  assert.equal(session.confirmedUserId(), "bob");
  assert.equal(localStorage.getItem("token"), "cookie.bob-session");
});

test("success delayed past explicit logout or current 401 cannot restore identity/legacy markers", async () => {
  for (const ending of ["logout", "401"]) {
    setup();
    const alice = deferred();
    globalThis.fetch = async (url) =>
      url === "/api/me" ? alice.promise : json({});
    const old = authDataLoader();
    if (ending === "logout") await logoutLoader();
    else {
      globalThis.fetch = async () => json({}, 401);
      await assert.rejects(api("/api/current"), ApiError);
    }
    alice.resolve(json(me()));
    await assert.rejects(old, aborted);
    assert.equal(session.confirmedUserId(), null);
    assert.equal(localStorage.getItem("token"), null);
    assert.equal(localStorage.getItem("userId"), null);
  }
});

test("obsolete me 401 cannot clear Bob or invoke unauthorized/redirect after his newer login", async () => {
  setup();
  const old401 = deferred();
  let count = 0;
  let unauthorized = 0;
  setUnauthorizedHandler(() => unauthorized++);
  try {
    globalThis.fetch = async (url) =>
      url === "/api/me"
        ? ++count === 1
          ? old401.promise
          : json(me("bob", "bob-session"))
        : json({});
    const old = authDataLoader();
    await authDataLoader();
    old401.resolve(json({}, 401));
    await assert.rejects(old, aborted);
    assert.equal(unauthorized, 0);
    assert.equal(session.confirmedUserId(), "bob");
    assert.equal(localStorage.getItem("token"), "cookie.bob-session");
    assert.equal(localStorage.getItem("userId"), "bob");
  } finally {
    setUnauthorizedHandler(() => {});
  }
});

test("router cancellation reaches me request and canceled root result cannot publish identity", async () => {
  setup();
  const reply = deferred();
  const controller = new AbortController();
  let sentSignal;
  globalThis.fetch = async (url, options) => {
    if (url !== "/api/me") return json({});
    sentSignal = options.signal;
    return reply.promise;
  };
  const request = new Request("https://example.test/dashboard", {
    signal: controller.signal,
  });
  const pending = authDataLoader({ request });
  controller.abort();
  reply.resolve(json(me()));
  await assert.rejects(pending, aborted);
  assert.equal(sentSignal, request.signal);
  assert.equal(session.confirmedUserId(), null);
  assert.equal(localStorage.getItem("token"), null);
});

test("another tab account switch invalidates root-preserving child navigation and rechecks cookie identity", async () => {
  setup();
  const tabA = window;
  globalThis.window = new EventTarget();
  const tabB = await import("./browser-session.js?second-tab");
  globalThis.window = tabA;
  let cookieOwner = me();
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return json(
      url === "/api/me" ? cookieOwner : { owner: cookieOwner.user._id },
    );
  };
  await authDataLoader();
  assert.deepEqual(await forms.load("/api/companies"), { owner: "alice" });
  cookieOwner = me("bob", "bob-session");
  tabB.confirmBrowserSession(cookieOwner);
  const event = new Event("storage");
  Object.defineProperty(event, "key", { value: "token" });
  tabA.dispatchEvent(event);
  assert.equal(session.confirmedUserId(), null);
  const meCallsBeforeChild = requests.filter((url) => url === "/api/me").length;
  // No root reload: just the child form's ordinary cache access.
  assert.deepEqual(await forms.load("/api/companies"), { owner: "bob" });
  assert.equal(
    requests.filter((url) => url === "/api/me").length,
    meCallsBeforeChild + 1,
  );
  assert.equal(session.confirmedUserId(), "bob");
  assert.equal(tabB.confirmedUserId(), "bob");
  assert.equal(localStorage.getItem("token"), "cookie.bob-session");
  // Another tab's logout is a hint to ask the server, not a local auth decision.
  cookieOwner = null;
  localStorage.removeItem("token");
  localStorage.removeItem("userId");
  tabA.dispatchEvent(event);
  globalThis.fetch = async () => json({}, 401);
  await assert.rejects(
    forms.load("/api/companies"),
    (error) => error instanceof ApiError && error.status === 401,
  );
  assert.equal(session.confirmedUserId(), null);
  assert.equal(localStorage.getItem("token"), null);
});

test("cross-tab outage preserves shared metadata, suspends old cache, and retries one shared me check", async () => {
  setup();
  globalThis.fetch = async (url) =>
    json(url === "/api/me" ? me() : { owner: "alice" });
  await authDataLoader();
  await forms.load("/api/companies");
  localStorage.setItem("token", "cookie.bob-session");
  localStorage.setItem("userId", "bob");
  globalThis.fetch = async () => json({}, 503);
  await assert.rejects(
    forms.load("/api/companies"),
    (error) => error.status === 503,
  );
  assert.equal(localStorage.getItem("token"), "cookie.bob-session");
  assert.equal(session.confirmedUserId(), null);
  const reply = deferred();
  let checks = 0;
  globalThis.fetch = async (url) => {
    if (url === "/api/me") {
      checks++;
      return reply.promise;
    }
    return json({ owner: "bob" });
  };
  const first = forms.load("/api/companies");
  const second = forms.load("/api/categories");
  reply.resolve(json(me("bob", "bob-session")));
  assert.deepEqual(await first, { owner: "bob" });
  assert.deepEqual(await second, { owner: "bob" });
  assert.equal(checks, 1);
});

test("logout invalidates immediately and cannot redirect/clear a newer login while its POST is pending", async () => {
  setup();
  const alice = deferred();
  const logoutReply = deferred();
  globalThis.fetch = async (url) =>
    url === "/api/me"
      ? alice.promise
      : url === "/api/logout"
        ? logoutReply.promise
        : json({});
  const old = authDataLoader();
  const logout = logoutLoader();
  alice.resolve(json(me()));
  await assert.rejects(old, aborted);
  assert.equal(localStorage.getItem("token"), null);
  globalThis.fetch = async (url) =>
    json(url === "/api/me" ? me("bob", "bob-session") : {});
  await authDataLoader();
  logoutReply.resolve(json({}));
  await assert.rejects(logout, aborted);
  assert.equal(session.confirmedUserId(), "bob");
  assert.equal(localStorage.getItem("token"), "cookie.bob-session");
});

test("auth layout's obsolete success cannot return a dashboard redirect after explicit logout", async () => {
  setup();
  const reply = deferred();
  globalThis.fetch = async (url) =>
    url === "/api/me" ? reply.promise : json({});
  const pending = routeLoader("pages/Auth/Layout.tsx")({
    request: new Request("https://example.test/auth"),
  });
  await logoutLoader();
  reply.resolve(json(me()));
  await assert.rejects(pending, aborted);
  assert.equal(localStorage.getItem("token"), null);
});

test("warm request from before same-session root revalidation cannot poison a new child navigation", async () => {
  setup();
  const oldWarm = deferred();
  let formRequests = 0;
  globalThis.fetch = async (url) => {
    if (url === "/api/me") return json(me());
    if (url === "/api/tickets/form-data") {
      formRequests++;
      return formRequests === 1
        ? oldWarm.promise
        : json({ owner: "alice", version: "current" });
    }
    return json({});
  };
  const { createMemoryRouter } = await import("react-router");
  const router = createMemoryRouter(
    [
      {
        id: "root",
        path: "/",
        loader: authDataLoader,
        children: [
          { path: "dashboard" },
          {
            id: "form",
            path: "tickets/add",
            loader: () => forms.load("/api/tickets/form-data"),
          },
        ],
      },
    ],
    { initialEntries: ["/dashboard"] },
  );
  const waitFor = (predicate) =>
    new Promise((resolve) => {
      if (predicate(router.state)) return resolve();
      const unsubscribe = router.subscribe((state) => {
        if (predicate(state)) {
          unsubscribe();
          resolve();
        }
      });
    });
  try {
    await waitFor((state) => state.initialized);
    forms.warm("/api/tickets/form-data");
    assert.equal(formRequests, 1);
    router.revalidate();
    await waitFor((state) => state.revalidation === "idle");
    const childNavigation = router.navigate("/tickets/add");
    oldWarm.resolve(json({ owner: "alice", version: "obsolete-warm" }));
    await childNavigation;
    assert.equal(router.state.errors, null);
    assert.deepEqual(router.state.loaderData.form, {
      owner: "alice",
      version: "current",
    });
    assert.equal(formRequests, 2);
    assert.deepEqual(await forms.load("/api/tickets/form-data"), {
      owner: "alice",
      version: "current",
    });
    assert.equal(formRequests, 2);
  } finally {
    router.dispose();
  }
});

test("background access refresh does not supersede an in-flight root identity check", async () => {
  setup();
  globalThis.fetch = async (url) => json(url === "/api/me" ? me() : {});
  await authDataLoader();
  const rootReply = deferred();
  let calls = 0;
  globalThis.fetch = async (url) => url === "/api/me"
    ? ++calls === 1 ? rootReply.promise : json({ ...me(), accessVersion: "changed" })
    : json({});
  const root = authDataLoader();
  const generation = session.browserSessionGeneration();
  const background = await refreshAuthData();
  assert.equal(session.browserSessionGeneration(), generation);
  rootReply.resolve(json(me()));
  assert.equal((await root).userData._id, "alice");
  assert.equal(background.userData.accessVersion, "changed");
});

test("background access refresh cannot adopt changed cookies or a late previous identity", async () => {
  setup();
  globalThis.fetch = async (url) => json(url === "/api/me" ? me() : {});
  await authDataLoader();
  globalThis.fetch = async (url) => json(url === "/api/me" ? me("bob", "s2") : {});
  assert.equal(await refreshAuthData(), null);
  assert.equal(session.confirmedUserId(), "alice");
  const lateReply = deferred();
  globalThis.fetch = async (url) => url === "/api/me" ? lateReply.promise : json({});
  const background = refreshAuthData();
  clearSession();
  lateReply.resolve(json(me()));
  await assert.rejects(background, aborted);
  assert.equal(session.confirmedUserId(), null);
});

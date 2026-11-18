import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const require = createRequire(import.meta.url);
async function loadStore(name, api) {
  // Use the project's bundler so aliases can be mocked without a test-only loader.
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "mock-api",
        enforce: "pre",
        resolveId(id) {
          if (id === "@/lib/api") return "\0mock-api";
          if (id === "./format-date") return "\0mock-date";
        },
        load(id) {
          if (id === "\0mock-api")
            return "export const api = (...args) => mockApi(...args);";
          if (id === "\0mock-date")
            return "export const formatShortDate = (value) => value;";
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL(`./${name}.js`, import.meta.url)),
        formats: ["cjs"],
      },
      rollupOptions: {
        external: ["zustand", "react", "react-icons/ri"],
        output: { exports: "named" },
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output.find(
    (entry) => entry.type === "chunk" && entry.isEntry,
  );
  const module = { exports: {} };
  new Function("require", "module", "exports", "mockApi", output.code)(
    require,
    module,
    module.exports,
    api,
  );
  return module.exports.default;
}

for (const [name, field, response] of [
  ["users", "items", (items) => ({ users: items, total: items.length })],
  ["knowledgeNotes", "originalList", (items) => items],
  ["locations", "originalList", (items) => items],
])
  test(`${name}: late request cannot overwrite the new navigation scope`, async () => {
    const requests = [];
    const store = await loadStore(
      name,
      () => new Promise((resolve) => requests.push(resolve)),
    );
    const older = store.getState().fetch();
    const newer = store.getState().fetch();
    requests[1](response([{ _id: "new", title: "New" }]));
    await newer;
    requests[0](response([{ _id: "old", title: "Old" }]));
    await older;
    assert.equal(store.getState()[field][0]._id, "new");
  });

for (const name of ["users", "client-devices", "knowledgeNotes"])
  test(`${name}: navigation cancels pending search debounce`, async (t) => {
    const calls = [];
    const store = await loadStore(name, async (url) => {
      calls.push(url);
      return name === "users"
        ? { users: [], total: 0 }
        : name === "client-devices"
          ? { devices: [], total: 0 }
          : [];
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    store.getState().fullTextSearch("old");
    store
      .getState()
      .restoreNavigationFilters({ searchTerm: "restored", page: 4 });
    t.mock.timers.tick(1000);
    assert.equal(store.getState().page, 4);
    assert.equal(calls.length, 0);
  });

test("knowledge navigation during first load starts a replacement request", async () => {
  const requests = [];
  const store = await loadStore(
    "knowledgeNotes",
    () => new Promise((resolve) => requests.push(resolve)),
  );
  const initial = store.getState().ensureLoaded();
  store.getState().restoreNavigationFilters({ companies: [{ _id: "c1" }] });
  const replacement = store.getState().ensureLoaded();
  assert.equal(requests.length, 2);
  requests[0]([]);
  requests[1]([]);
  await Promise.all([initial, replacement]);
  assert.equal(store.getState().isLoading, false);
  assert.equal(store.getState().loaded, true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetcherRefresh } from "./live-fetcher.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
test("refresh waits for the network and committed fetcher data", async () => {
  let finish;
  let commits = 0;
  const refresh = createFetcherRefresh(() => commits++);
  let settled = false;
  const result = refresh.run(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  result.then(() => {
    settled = true;
  });
  refresh.commit({ items: ["old"] });
  await flush();
  assert.equal(settled, false);
  finish();
  await flush();
  assert.equal(commits, 1);
  assert.equal(settled, false);
  refresh.commit({ items: ["new"] });
  assert.equal(await result, true);
});
test("failed loader data remains retryable and overlapping runs share one request", async () => {
  let calls = 0;
  const refresh = createFetcherRefresh(() => {});
  const load = async () => {
    calls++;
  };
  const first = refresh.run(load);
  assert.equal(refresh.run(load), first);
  await flush();
  refresh.commit({ error: true });
  assert.equal(await first, false);
  const second = refresh.run(load);
  await flush();
  refresh.commit({ items: [] });
  assert.equal(await second, true);
  assert.equal(calls, 2);
});
test("rejections and disposal release the pending consumer without acknowledging data", async () => {
  const refresh = createFetcherRefresh(() => {});
  assert.equal(
    await refresh.run(async () => {
      throw new Error("offline");
    }),
    false,
  );
  const pending = refresh.run(() => new Promise(() => {}));
  refresh.dispose();
  assert.equal(await pending, false);
});

test("Proxmox pulse retries a failed section without losing a paused update", async () => {
  const { createLiveConsumer } = await import("../../lib/pulse/live-cursor.ts");
  let calls = 0;
  const refresh = createFetcherRefresh(() => {});
  const consumer = createLiveConsumer({
    watch: { topics: ["proxmox"] },
    baseline: { epoch: "e", rev: 1 },
    enabled: false,
    run: () =>
      refresh.run(async () => {
        calls++;
      }),
  });
  consumer.onSnapshot({
    epoch: "e",
    rev: 2,
    topics: { proxmox: 2 },
    tickets: {},
  });
  await flush();
  assert.equal(calls, 0);
  consumer.setEnabled(true);
  await flush();
  assert.equal(calls, 1);
  refresh.commit({ error: true });
  await flush();
  consumer.onSnapshot({
    epoch: "e",
    rev: 2,
    topics: { proxmox: 2 },
    tickets: {},
  });
  await flush();
  assert.equal(calls, 2);
  refresh.commit({ items: [] });
  await flush();
  consumer.onSnapshot({
    epoch: "e",
    rev: 2,
    topics: { proxmox: 2 },
    tickets: {},
  });
  await flush();
  assert.equal(calls, 2);
  consumer.dispose();
});

test("network completion cannot acknowledge the preceding React result", async () => {
  const refresh = createFetcherRefresh(() => {});
  const oldData = { items: ["old"] };
  let settled = false;
  const result = refresh.run(async () => {}, oldData);
  result.then(() => {
    settled = true;
  });
  await flush();
  refresh.commit(oldData);
  await flush();
  assert.equal(settled, false);
  refresh.commit({ items: ["new"] });
  assert.equal(await result, true);
});

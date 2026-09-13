// node --test src/lib/pulse/live-cursor.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { createLiveConsumer, hasMoved, parseCursor } from "./live-cursor.ts";

// Fake clock and timers: the consumer never touches the real ones
const clock = () => {
  let time = 1_000_000;
  const timers = [];
  return {
    now: () => time,
    setTimer: (fn, ms) => {
      const timer = { fn, at: time + ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
    advance: (ms) => {
      time += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at <= time) {
          timers.splice(timers.indexOf(timer), 1);
          timer.fn();
        }
      }
    },
  };
};

const snap = (rev, topics = {}, tickets = {}, epoch = "e1") => ({ epoch, rev, topics, tickets });
const flush = () => new Promise((resolve) => setImmediate(resolve));

const setup = (overrides = {}) => {
  const time = clock();
  const runs = [];
  const consumer = createLiveConsumer({
    watch: { topics: ["tickets"] },
    run: () => runs.push(time.now()),
    baseline: { epoch: "e1", rev: 5 },
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    ...overrides,
  });
  return { time, runs, consumer };
};

test("parseCursor reads the header and rejects garbage", () => {
  assert.deepEqual(parseCursor("mtz1-ab12:42"), { epoch: "mtz1-ab12", rev: 42 });
  assert.equal(parseCursor("nocolon"), null);
  assert.equal(parseCursor(":5"), null);
  assert.equal(parseCursor("e:x"), null);
  assert.equal(parseCursor(null), null);
});

test("hasMoved: topic, ticket, epoch", () => {
  const base = { epoch: "e1", rev: 5 };
  assert.equal(hasMoved(snap(9, { tickets: 5 }), base, { topics: ["tickets"] }), false);
  assert.equal(hasMoved(snap(9, { tickets: 6 }), base, { topics: ["tickets"] }), true);
  assert.equal(hasMoved(snap(9, { presence: 9 }), base, { topics: ["tickets"] }), false);
  assert.equal(hasMoved(snap(9, {}, { t1: 7 }), base, { topics: [], ticketId: "t1" }), true);
  assert.equal(hasMoved(snap(9, {}, { t1: null }), base, { topics: [], ticketId: "t1" }), false);
  assert.equal(hasMoved(snap(1, {}, {}, "e2"), base, { topics: [] }), true);
});

test("no change → no run; change → exactly one run", async () => {
  const { runs, consumer } = setup();
  consumer.onSnapshot(snap(8, { tickets: 5 }));
  assert.equal(runs.length, 0);
  consumer.onSnapshot(snap(9, { tickets: 9 }));
  assert.equal(runs.length, 1);
  await flush();
  consumer.onSnapshot(snap(9, { tickets: 9 }));
  consumer.onSnapshot(snap(10, { tickets: 9 }));
  assert.equal(runs.length, 1);
});

test("no baseline: the first snapshot is adopted silently", () => {
  const { runs, consumer } = setup({ baseline: null });
  consumer.onSnapshot(snap(9, { tickets: 9 }));
  assert.equal(runs.length, 0);
  consumer.onSnapshot(snap(10, { tickets: 10 }));
  assert.equal(runs.length, 1);
});

test("a change while disabled is remembered and fires exactly once on enable", async () => {
  const { runs, consumer } = setup({ enabled: false });
  consumer.onSnapshot(snap(9, { tickets: 9 }));
  consumer.onSnapshot(snap(10, { tickets: 9 }));
  assert.equal(runs.length, 0);
  consumer.setEnabled(true);
  assert.equal(runs.length, 1);
  await flush();
  consumer.setEnabled(false);
  consumer.setEnabled(true);
  assert.equal(runs.length, 1);
});

test("a change while running fires again after the run settles", async () => {
  let resolveRun;
  const time = clock();
  let runs = 0;
  const consumer = createLiveConsumer({
    watch: { topics: ["tickets"] },
    run: () => {
      runs += 1;
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
    baseline: { epoch: "e1", rev: 5 },
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  consumer.onSnapshot(snap(9, { tickets: 9 }));
  assert.equal(runs, 1);
  consumer.onSnapshot(snap(12, { tickets: 12 }));
  assert.equal(runs, 1, "not while running");
  resolveRun();
  await flush();
  assert.equal(runs, 2, "the change during the run is not lost");
});

test("minIntervalMs defers without losing the change", async () => {
  const { time, runs, consumer } = setup({ minIntervalMs: 15_000 });
  consumer.onSnapshot(snap(9, { tickets: 9 }));
  assert.equal(runs.length, 1);
  await flush();
  time.advance(5_000);
  consumer.onSnapshot(snap(10, { tickets: 10 }));
  assert.equal(runs.length, 1);
  time.advance(9_999);
  assert.equal(runs.length, 1);
  time.advance(1);
  assert.equal(runs.length, 2);
});

test("maxStaleMs refetches with no change at all", async () => {
  const { time, runs, consumer } = setup({ maxStaleMs: 60_000 });
  consumer.onSnapshot(snap(5, { tickets: 5 }));
  assert.equal(runs.length, 0);
  time.advance(60_000);
  consumer.onSnapshot(snap(5, { tickets: 5 }));
  assert.equal(runs.length, 1);
  await flush();
  consumer.onSnapshot(snap(5, { tickets: 5 }));
  assert.equal(runs.length, 1);
});

test("epoch change (backend restart) refetches once", async () => {
  const { runs, consumer } = setup();
  consumer.onSnapshot(snap(0, { tickets: 0 }, {}, "e2"));
  assert.equal(runs.length, 1);
  await flush();
  consumer.onSnapshot(snap(0, { tickets: 0 }, {}, "e2"));
  assert.equal(runs.length, 1);
});

test("markFresh from a loader cursor suppresses the refetch of its own change", () => {
  const { runs, consumer } = setup();
  consumer.markFresh({ epoch: "e1", rev: 9 });
  consumer.onSnapshot(snap(9, { tickets: 9 }));
  assert.equal(runs.length, 0);
});

test("a failed run keeps the baseline and retries on the next pulse", async () => {
  let fail = true;
  let runs = 0;
  const time = clock();
  const consumer = createLiveConsumer({
    watch: { topics: ["tickets"] },
    run: async () => {
      runs += 1;
      if (fail) throw new Error("offline");
    },
    baseline: { epoch: "e1", rev: 5 },
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    consumer.onSnapshot(snap(9, { tickets: 9 }));
    await flush();
    assert.equal(runs, 1, "no tight retry loop");
    fail = false;
    consumer.onSnapshot(snap(9, { tickets: 9 }));
    assert.equal(runs, 2);
  } finally {
    console.warn = warn;
  }
});

test("dispose stops everything", () => {
  const { time, runs, consumer } = setup({ minIntervalMs: 10_000 });
  consumer.onSnapshot(snap(9, { tickets: 9 }));
  consumer.onSnapshot(snap(10, { tickets: 10 }));
  consumer.dispose();
  time.advance(20_000);
  consumer.onSnapshot(snap(11, { tickets: 11 }));
  assert.equal(runs.length, 1);
});

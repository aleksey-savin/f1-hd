/**
 * One live-update consumer: "does this page need to refetch, and may it now?"
 *
 * The pulse (`GET /api/pulse`, see store/pulse.ts) brings revisions per topic and
 * per watched ticket. A consumer remembers the revision its data corresponds to —
 * the baseline — and refetches when something it watches moved past it.
 *
 * Why the baseline does not advance until the refetch actually runs: a change
 * that arrives while the page is paused (selection mode, an open form, the
 * minimum interval) stays "moved past the baseline" and fires as soon as the
 * pause ends. Nothing has to remember it separately.
 *
 * Pure, no React: hooks/use-live-topic.ts wires it to the store; tests drive it
 * with a fake clock (live-cursor.test.js).
 */

export type PulseCursor = { epoch: string; rev: number };

export type PulseSnapshot = PulseCursor & {
  topics: Record<string, number>;
  /** Revision per watched ticket id; null when the ticket is not accessible */
  tickets: Record<string, number | null>;
};

export type LiveWatch = {
  topics: readonly string[];
  ticketId?: string | null;
};

/** Refetch anyway after this long: writes the server cannot see (other processes) */
export const DEFAULT_MAX_STALE_MS = 10 * 60_000;

/** `"<epoch>:<rev>"` (the X-Pulse-Cursor header) → cursor */
export const parseCursor = (raw: string | null | undefined): PulseCursor | null => {
  if (typeof raw !== "string") return null;
  const separator = raw.lastIndexOf(":");
  if (separator <= 0) return null;
  const rev = Number(raw.slice(separator + 1));
  return Number.isInteger(rev) && rev >= 0
    ? { epoch: raw.slice(0, separator), rev }
    : null;
};

export const cursorOf = (snapshot: PulseSnapshot | null): PulseCursor | null =>
  snapshot ? { epoch: snapshot.epoch, rev: snapshot.rev } : null;

/** Did anything the consumer watches change after its baseline? */
export const hasMoved = (
  snapshot: PulseSnapshot,
  baseline: PulseCursor,
  watch: LiveWatch,
): boolean => {
  // Another backend process: its counters mean nothing against ours
  if (snapshot.epoch !== baseline.epoch) return true;
  if (watch.topics.some((topic) => (snapshot.topics[topic] ?? 0) > baseline.rev)) {
    return true;
  }
  if (watch.ticketId) {
    const rev = snapshot.tickets[watch.ticketId];
    if (typeof rev === "number" && rev > baseline.rev) return true;
  }
  return false;
};

type ConsumerOptions = {
  watch: LiveWatch;
  /** The refetch; may return a promise — the consumer waits for it */
  run: () => unknown;
  baseline?: PulseCursor | null;
  enabled?: boolean;
  maxStaleMs?: number;
  /** At least this long between two runs (a busy topic must not hammer a heavy list) */
  minIntervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type LiveConsumer = {
  onSnapshot: (snapshot: PulseSnapshot) => void;
  setEnabled: (enabled: boolean) => void;
  /** The data now corresponds to this cursor (e.g. a loader's X-Pulse-Cursor) */
  markFresh: (cursor: PulseCursor | null) => void;
  dispose: () => void;
};

export const createLiveConsumer = (options: ConsumerOptions): LiveConsumer => {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const minIntervalMs = options.minIntervalMs ?? 0;

  let baseline: PulseCursor | null = options.baseline ?? null;
  let enabled = options.enabled ?? true;
  let latest: PulseSnapshot | null = null;
  let freshAt = now();
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let running = false;
  let disposed = false;
  let timer: unknown = null;

  // Forward only within one epoch: a slower refetch must not roll back the
  // cursor a newer load already set
  const advance = (next: PulseCursor | null) => {
    if (!next) return;
    if (!baseline || next.epoch !== baseline.epoch || next.rev > baseline.rev) {
      baseline = next;
    }
  };

  const evaluate = () => {
    if (disposed || !latest) return;
    // No baseline yet (first load raced the first pulse): adopt silently
    if (!baseline) {
      baseline = cursorOf(latest);
      return;
    }
    const dirty =
      hasMoved(latest, baseline, options.watch) || now() - freshAt >= maxStaleMs;
    if (!dirty || !enabled || running) return;

    const wait = lastRunAt + minIntervalMs - now();
    if (wait > 0) {
      if (timer === null) {
        timer = setTimer(() => {
          timer = null;
          evaluate();
        }, wait);
      }
      return;
    }
    fire();
  };

  const fire = () => {
    // Everything up to the snapshot that triggered the run is in the new data;
    // a change after it shows up as a newer revision and runs again
    const target = cursorOf(latest);
    running = true;
    lastRunAt = now();

    const settle = (ok: boolean) => {
      running = false;
      if (disposed) return;
      if (ok) {
        advance(target);
        freshAt = now();
        evaluate();
      }
      // Failed: baseline stays, the next pulse retries (no tight loop here)
    };

    let result: unknown;
    try {
      result = options.run();
    } catch (error) {
      console.warn("live update skipped:", error);
      settle(false);
      return;
    }
    Promise.resolve(result).then(
      () => settle(true),
      (error) => {
        console.warn("live update skipped:", error);
        settle(false);
      },
    );
  };

  return {
    onSnapshot: (snapshot) => {
      latest = snapshot;
      evaluate();
    },
    setEnabled: (next) => {
      enabled = next;
      if (next) evaluate();
    },
    markFresh: (cursor) => {
      if (!cursor) return;
      advance(cursor);
      freshAt = now();
    },
    dispose: () => {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
};

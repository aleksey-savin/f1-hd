/**
 * How the pulse reaches the page. Today: polling. The store and hooks only see
 * `start/stop/poke`, so a server push (SSE) can replace this without touching
 * any page.
 */
export type PulseTransport = {
  start: () => void;
  stop: () => void;
  /** Ask now (tab became visible, a page needs a faster answer) */
  poke: () => void;
};

type PollingOptions = {
  /** One pulse; rejects on a network or HTTP error */
  request: () => Promise<void>;
  /** Delay until the next pulse after a successful one */
  delay: () => number;
  maxBackoffMs?: number;
};

/**
 * Visibility-aware polling: nothing while the tab is hidden, an immediate pulse
 * when it comes back (the data may be minutes old), exponential backoff on
 * errors — a sleeping laptop or a deploy must not produce a storm of failures.
 */
export const createPollingTransport = ({
  request,
  delay,
  maxBackoffMs = 60_000,
}: PollingOptions): PulseTransport => {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let queued = false;
  let failures = 0;

  const visible = () => document.visibilityState === "visible";

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (ms: number) => {
    clear();
    if (active && visible()) timer = setTimeout(tick, ms);
  };

  const tick = async (): Promise<void> => {
    timer = null;
    if (!active) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      await request();
      failures = 0;
    } catch (error) {
      failures += 1;
      console.warn("pulse: skipped:", error);
    } finally {
      inFlight = false;
    }
    if (queued && failures === 0) {
      queued = false;
      return tick();
    }
    queued = false;
    const base = delay();
    schedule(failures ? Math.min(base * 2 ** failures, maxBackoffMs) : base);
  };

  const poke = () => {
    if (!active || !visible()) return;
    clear();
    void tick();
  };

  const onVisibility = () => {
    if (visible()) poke();
    else clear();
  };

  return {
    start: () => {
      if (active) return;
      active = true;
      document.addEventListener("visibilitychange", onVisibility);
      poke();
    },
    stop: () => {
      active = false;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    },
    poke,
  };
};

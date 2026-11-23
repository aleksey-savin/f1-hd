import { useEffect, useRef } from "react";

import {
  createLiveConsumer,
  parseCursor,
  type LiveConsumer,
} from "@/lib/pulse/live-cursor";
import usePulseStore from "@/store/pulse";
import { onBrowserSessionChange } from "@/util/browser-session.js";

type LiveTopicOptions = {
  /** false pauses: a change is remembered and applied when it turns true */
  enabled?: boolean;
  /** Watch one ticket instead of (or in addition to) whole topics */
  ticketId?: string | null;
  /** X-Pulse-Cursor the page's data was loaded with (route loaders) */
  baseline?: string | null;
  maxStaleMs?: number;
  minIntervalMs?: number;
  /** Request faster shared polling while this consumer is enabled and visible. */
  cadenceMs?: number;
};

/**
 * Refetch when the data behind a page changed on the server.
 *
 *   useLiveTopic("tickets", () => store.silentRefresh(), {
 *     enabled: !selection.isActive,
 *     minIntervalMs: 15_000,
 *   });
 *
 * Topics: tickets, presence, team, mikrotik, approval, knowledge, channels,
 * conversations (see backend/services/pulseTopics.js). `onChange` may return
 * a promise; the next run waits for it. Never add a timer of your own for
 * live data — see docs/live-updates.md.
 */
const useLiveTopic = (
  topics: string | readonly string[],
  onChange: () => unknown,
  options: LiveTopicOptions = {},
) => {
  const {
    enabled = true,
    ticketId = null,
    baseline = null,
    maxStaleMs,
    minIntervalMs,
    cadenceMs,
  } = options;

  const run = useRef(onChange);
  run.current = onChange;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const consumerRef = useRef<LiveConsumer | null>(null);

  const topicsKey = (typeof topics === "string" ? [topics] : topics).join(",");

  useEffect(() => {
    const consumer = createLiveConsumer({
      watch: { topics: topicsKey ? topicsKey.split(",") : [], ticketId },
      run: () => run.current(),
      // Only the data request's cursor certifies which changes it includes.
      baseline: parseCursor(baselineRef.current),
      enabled: enabledRef.current && document.visibilityState !== "hidden",
      maxStaleMs,
      minIntervalMs,
    });
    consumerRef.current = consumer;
    const syncVisibility = () => consumer.setEnabled(enabledRef.current && document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", syncVisibility);
    const releaseSession = onBrowserSessionChange(() => consumer.invalidate());
    const release = ticketId
      ? usePulseStore.getState().watchTicket(ticketId)
      : undefined;
    const unsubscribe = usePulseStore.subscribe((state, prev) => {
      if (state.snapshot && state.snapshot !== prev.snapshot) {
        consumer.onSnapshot(state.snapshot);
      }
    });
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", syncVisibility);
      releaseSession();
      release?.();
      consumer.dispose();
      consumerRef.current = null;
    };
  }, [topicsKey, ticketId, maxStaleMs, minIntervalMs]);

  useEffect(() => {
    consumerRef.current?.setEnabled(enabled && document.visibilityState !== "hidden");
  }, [enabled]);

  useEffect(() => {
    let release: (() => void) | undefined;
    const sync = () => {
      release?.();
      release = undefined;
      if (enabled && cadenceMs && document.visibilityState !== "hidden") {
        release = usePulseStore.getState().requestCadence(cadenceMs);
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      release?.();
    };
  }, [enabled, cadenceMs]);

  useEffect(() => {
    consumerRef.current?.markFresh(parseCursor(baseline));
  }, [baseline]);
};

export default useLiveTopic;

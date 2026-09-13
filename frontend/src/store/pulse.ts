import { create } from "zustand";

import type { PulseSnapshot } from "@/lib/pulse/live-cursor";
import type { NotificationsSummary } from "@/types/notification";

/**
 * Live updates: the last pulse and what the open pages ask the pulse for.
 *
 * One light `GET /api/pulse` per tab (components/app/PulseLoop) replaces the
 * heavy per-widget polls: the server keeps a revision per topic, and a page
 * refetches only when its topic moved (hooks/use-live-topic). Pulses change
 * `snapshot` only — consumers subscribe outside React, so a pulse re-renders
 * nothing by itself.
 *
 * See docs/live-updates.md.
 */

export type PulseMessage = {
  epoch: string;
  rev: number;
  pollMs: number;
  appVersion: string;
  topics: Record<string, number>;
  tickets: Record<string, number | null>;
  /** Present when the person's inbox changed (or the request had no cursor) */
  notifications?: NotificationsSummary;
};

type PulseState = {
  snapshot: PulseSnapshot | null;
  appVersion: string | null;
  pollMs: number;
  /** Ticket id → number of open pages watching it */
  watched: Record<string, number>;
  /** Requested faster pulse intervals, by request id */
  cadences: Record<number, number>;
  ingest: (message: PulseMessage) => void;
  watchTicket: (ticketId: string) => () => void;
  /** Pulse at least this often until released (e.g. AI guide generating) */
  requestCadence: (ms: number) => () => void;
};

let cadenceSeq = 0;

const usePulseStore = create<PulseState>()((set, get) => ({
  snapshot: null,
  appVersion: null,
  pollMs: 10_000,
  watched: {},
  cadences: {},

  ingest: (message) =>
    set({
      snapshot: {
        epoch: message.epoch,
        rev: message.rev,
        topics: message.topics ?? {},
        tickets: message.tickets ?? {},
      },
      appVersion: message.appVersion ?? get().appVersion,
      pollMs: message.pollMs || get().pollMs,
    }),

  watchTicket: (ticketId) => {
    set((state) => ({
      watched: { ...state.watched, [ticketId]: (state.watched[ticketId] ?? 0) + 1 },
    }));
    return () =>
      set((state) => {
        const count = (state.watched[ticketId] ?? 0) - 1;
        const watched = { ...state.watched };
        if (count > 0) watched[ticketId] = count;
        else delete watched[ticketId];
        return { watched };
      });
  },

  requestCadence: (ms) => {
    const id = ++cadenceSeq;
    set((state) => ({ cadences: { ...state.cadences, [id]: ms } }));
    return () =>
      set((state) => {
        const cadences = { ...state.cadences };
        delete cadences[id];
        return { cadences };
      });
  },
}));

export default usePulseStore;

import { useEffect } from "react";

import { api } from "@/lib/api";
import { createPollingTransport } from "@/lib/pulse/transport";
import useNotificationsStore from "@/store/notifications";
import usePulseStore, { type PulseMessage } from "@/store/pulse";

/**
 * The one pulse of the tab (docs/live-updates.md). Renders nothing; mounted once
 * in layout/Root for a signed-in person.
 *
 * Every few minutes the request goes without a cursor: the server then returns
 * the bell summary unconditionally, which resyncs anything the in-memory
 * counters could not see (a TTL delete, another process).
 */
const FULL_SYNC_MS = 5 * 60_000;
const MIN_DELAY_MS = 3_000;

const PulseLoop = () => {
  useEffect(() => {
    let lastFullAt = 0;

    const transport = createPollingTransport({
      request: async () => {
        const { snapshot, watched } = usePulseStore.getState();
        const params = new URLSearchParams();
        const full = !snapshot || Date.now() - lastFullAt >= FULL_SYNC_MS;
        if (!full && snapshot) {
          params.set("cursor", `${snapshot.epoch}:${snapshot.rev}`);
        }
        const ticketIds = Object.keys(watched);
        if (ticketIds.length) params.set("ticket", ticketIds.join(","));

        const message = await api<PulseMessage>(`/api/pulse?${params}`);
        if (full) lastFullAt = Date.now();
        usePulseStore.getState().ingest(message);
        if (message.notifications) {
          await useNotificationsStore
            .getState()
            .applySummary(message.notifications);
        }
      },
      delay: () => {
        const { pollMs, cadences } = usePulseStore.getState();
        return Math.max(MIN_DELAY_MS, Math.min(pollMs, ...Object.values(cadences)));
      },
    });

    transport.start();
    // A page asked for a faster pulse: don't make it wait out the current delay
    const unsubscribe = usePulseStore.subscribe((state, prev) => {
      if (
        Object.keys(state.cadences).length > Object.keys(prev.cadences).length
      ) {
        transport.poke();
      }
    });
    return () => {
      unsubscribe();
      transport.stop();
    };
  }, []);

  return null;
};

export default PulseLoop;

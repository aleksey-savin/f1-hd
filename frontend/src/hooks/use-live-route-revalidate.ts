import { useDeferredRevalidate } from "@/components/app/use-refresh-route";
import useLiveTopic from "@/hooks/use-live-topic";

/**
 * `useLiveTopic` for pages drawn from a route loader: the change re-runs the
 * loader, but only once every fetcher is idle (see use-refresh-route.js).
 *
 *   useLiveRouteRevalidate([], { ticketId: ticket._id, baseline: data.pulse });
 */
const useLiveRouteRevalidate = (
  topics: string | readonly string[],
  options: Parameters<typeof useLiveTopic>[2] = {},
) => {
  const revalidate = useDeferredRevalidate();
  useLiveTopic(topics, revalidate, options);
};

export default useLiveRouteRevalidate;

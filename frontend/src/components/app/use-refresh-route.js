import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_DataRouterContext, useFetchers, useRevalidator } from "react-router";
import { createDeferredRefresh } from "@/lib/pulse/deferred-refresh";

/** Revalidate only while visible, enabled and all router fetchers are idle. */
export const useDeferredRevalidate = ({ enabled = true } = {}) => {
  const revalidator = useRevalidator();
  const fetchers = useFetchers();
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const queue = useRef(null);
  const run = useRef(null);
  run.current = async () => {
    await revalidator.revalidate();
    // React Router resolves revalidate() even when a loader enters an error boundary.
    return !router?.state.errors;
  };
  const ready = enabled && visible && revalidator.state === "idle" &&
    fetchers.every(fetcher => fetcher.state === "idle");
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const current = createDeferredRefresh(() => run.current());
    queue.current = current;
    current.setReady(readyRef.current);
    const onVisibility = () => {
      const next = document.visibilityState !== "hidden";
      if (!next) current.setReady(false);
      setVisible(next);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      current.dispose();
      queue.current = null;
    };
  }, []);

  useEffect(() => { queue.current?.setReady(ready); }, [ready]);
  return useCallback(() => queue.current?.request() ?? Promise.resolve(false), []);
};

/** Manual mutations can share the same deferred route refresh. */
const useRefreshRoute = () => {
  const revalidate = useDeferredRevalidate();
  return () => { void revalidate(); };
};
export default useRefreshRoute;

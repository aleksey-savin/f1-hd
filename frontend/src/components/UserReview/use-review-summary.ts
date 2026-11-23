import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/store/authed-user";
import useLiveTopic from "@/hooks/use-live-topic";
import type { ReviewSummary } from "@/types/userReview";

export default function useReviewSummary() {
  const can = useCan();
  const enabled = can({ userReview: ["read"] });
  const [data, setData] = useState<ReviewSummary>();
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return false;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const value = await api<ReviewSummary>("/api/user-review/summary", {
        signal: controller.signal,
      });
      if (controller.signal.aborted || request.current !== controller)
        return false;
      setData(value);
    } catch {
      return false;
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [enabled]);
  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);
  useLiveTopic("userReview", refresh, { enabled });
  return enabled ? data : undefined;
}

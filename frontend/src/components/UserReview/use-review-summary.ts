import { useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { useCan } from "@/store/authed-user";
import useLiveTopic from "@/hooks/use-live-topic";
import type { ReviewSummary } from "@/types/userReview";

export default function useReviewSummary() {
  const can = useCan();
  const enabled = can({ userReview: ["read"] });
  const { load, data } = useFetcher<ReviewSummary>();
  const refresh = useCallback(() => {
    if (enabled) return load("/users/review/summary");
  }, [enabled, load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useLiveTopic("userReview", refresh, { enabled });
  return enabled ? data : undefined;
}

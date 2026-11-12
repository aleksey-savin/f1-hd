import { Link } from "@/components/app/navigation";
import { useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import { Eyebrow, Panel } from "@/components/app/Panel";
import { useCan } from "@/store/authed-user";
import useLiveTopic from "@/hooks/use-live-topic";
import ProposalDetail from "@/components/UserReview/ProposalDetail";
import type { ReviewPage, ReviewProposal } from "@/types/userReview";

export default function UserReviewSection({ ticketId }: { ticketId: string }) {
  const can = useCan();
  const enabled = can({ userReview: ["read"] });
  const { load, data } = useFetcher<ReviewPage<ReviewProposal>>();
  const refresh = useCallback(() => {
    if (enabled)
      return load(`/users/review/ticket/${encodeURIComponent(ticketId)}`);
  }, [enabled, load, ticketId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useLiveTopic("userReview", refresh, { enabled });
  if (!enabled || !data?.items?.length) return null;
  return (
    <div>
      <Eyebrow
        count={data.total}
        action={
          <Button asChild variant="outline" size="xs">
            <Link to={`/users/review?ticketId=${ticketId}`}>
              Все предложения →
            </Link>
          </Button>
        }
      >
        Проверка учётной записи
      </Eyebrow>
      <Panel>
        <div className="space-y-6">
          {data.items.slice(0, 3).map((proposal) => (
            <ProposalDetail key={proposal._id} proposal={proposal} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

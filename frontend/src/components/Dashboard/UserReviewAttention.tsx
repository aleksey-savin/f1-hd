import { Link } from "@/components/app/navigation";

import { RiArrowRightSLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { Eyebrow, Panel } from "@/components/app/Panel";
import useReviewSummary from "@/components/UserReview/use-review-summary";
import {
  kindLabel,
  proposalName,
  proposalUser,
} from "@/components/UserReview/ProposalDetail";

export default function UserReviewAttention() {
  const summary = useReviewSummary();
  if (!summary?.pending) return null;
  return (
    <section>
      <Eyebrow
        count={summary.pending}
        action={
          <Button asChild variant="outline" size="xs">
            <Link to="/users/review">
              Открыть проверку
              <RiArrowRightSLine />
            </Link>
          </Button>
        }
      >
        Пользователи ждут проверки
      </Eyebrow>
      <Panel className="overflow-hidden p-0">
        <div className="flex flex-wrap gap-2 border-b border-border-soft px-5 py-3">
          {Object.entries(summary.byKind)
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => (
              <Link
                key={kind}
                to={`/users/review?kind=${kind}`}
                className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground no-underline hover:border-primary"
              >
                {kindLabel[kind as keyof typeof kindLabel]}
                <span className="font-semibold text-foreground">{count}</span>
              </Link>
            ))}
        </div>
        {summary.items.map((proposal) => (
          <Link
            key={proposal._id}
            to={`/users/review?selected=${proposal._id}`}
            className="flex items-center gap-3 border-b border-border-soft px-5 py-3 text-foreground no-underline last:border-0 hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {proposalName(proposal)}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {proposalUser(proposal)?.company?.alias} ·{" "}
                {kindLabel[proposal.kind]}
              </div>
            </div>
            <RiArrowRightSLine className="text-faint" />
          </Link>
        ))}
      </Panel>
    </section>
  );
}

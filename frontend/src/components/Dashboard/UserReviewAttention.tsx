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
  const openReview = (
    <Button asChild variant="outline" size="xs">
      <Link to="/users/review">
        Открыть проверку
        <RiArrowRightSLine />
      </Link>
    </Button>
  );
  return (
    <section className="@container">
      <Eyebrow action={<span className="@max-md:hidden">{openReview}</span>}>
        <span className="min-w-0">
          Пользователи ждут проверки{" "}
          <span className="font-semibold tracking-normal whitespace-nowrap tabular-nums">
            · {summary.pending}
          </span>
        </span>
      </Eyebrow>
      <div className="mb-2.5 @md:hidden">{openReview}</div>
      <Panel className="overflow-hidden p-0 md:p-0">
        <div className="flex gap-2 overflow-x-auto border-b border-border-soft px-4 py-3 scrollbar-none md:flex-wrap md:px-5">
          {Object.entries(summary.byKind)
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => (
              <Link
                key={kind}
                to={`/users/review?kind=${kind}`}
                className="inline-flex flex-none items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs whitespace-nowrap text-muted-foreground no-underline hover:border-primary"
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
            className="flex items-center gap-3 border-b border-border-soft px-4 py-3 text-foreground no-underline last:border-0 hover:bg-accent md:px-5"
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

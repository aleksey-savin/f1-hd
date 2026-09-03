import { useContext, useEffect, useState } from "react";
import { RiArrowDownSLine, RiArrowUpSLine } from "react-icons/ri";

import { Eyebrow } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import usePolling from "../../hooks/use-polling";
import { AuthedUserContext } from "../../store/authed-user-context";
import useWorkStatusesStore from "../../store/work-statuses";
import { availabilitySummary, groupByStatus } from "../User/presence";
import { GroupHeading, IdleGroup, PersonRow } from "../User/PresenceList";
import WorkStatusAvatar from "../User/WorkStatusAvatar";

// «Команда сейчас» — присутствие коллег на главной сотрудника, ТОЛЬКО на
// телефоне: на десктопе ту же роль играет рейл статусов, и блок был бы
// дублированием. По умолчанию — закрытая плашка: живая точка, сводка от
// доступности и стопка аватаров; по тапу раскрывается в то же табло, что в
// рейле (группы, строки, свёрнутые «не на работе»). Ленты сверху каждого
// экрана, которая жила в шелле, больше нет — это её замена.
const TeamNow = () => {
  const authedUser = useContext(AuthedUserContext);
  const { users, isLoaded, silentRefresh } = useWorkStatusesStore();
  const [open, setOpen] = useState(false);
  const [idleOpen, setIdleOpen] = useState({});

  const isStaff =
    !!authedUser._id && !authedUser.isEndUser && !authedUser.hideWorkStatus;

  useEffect(() => {
    if (isStaff) {
      silentRefresh();
    }
  }, [isStaff, silentRefresh]);

  usePolling(silentRefresh, { intervalMs: 15000, enabled: isStaff });

  if (!isStaff || !isLoaded) {
    return null;
  }

  const colleagues = users.filter(
    (user) => String(user._id) !== String(authedUser._id),
  );
  if (colleagues.length === 0) {
    return null;
  }

  const groups = groupByStatus(colleagues);
  const shown = groups.filter((group) => group.status.kind !== "idle");
  const idle = groups.filter((group) => group.status.kind === "idle");
  const summary = availabilitySummary(colleagues);
  // Стопка — по одному человеку из каждой группы на связи, не больше четырёх
  const stack = shown.map((group) => group.users[0]).slice(0, 4);

  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="mb-5 flex w-full cursor-pointer appearance-none items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/50"
      >
        <span
          className="ws-live relative inline-block size-2 flex-none rounded-full bg-primary"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold tracking-wider text-muted-foreground uppercase">
            Команда сейчас
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {summary}
          </span>
        </span>
        {stack.length > 0 && (
          <span className="flex flex-none items-center">
            {stack.map((user, index) => (
              <span key={user._id} className={cn(index > 0 && "-ms-2")}>
                <WorkStatusAvatar
                  size={24}
                  firstName={user.firstName}
                  lastName={user.lastName}
                  profileImagePath={user.profileImagePath}
                  workStatus={user.workStatus}
                  showBadge={false}
                />
              </span>
            ))}
          </span>
        )}
        <RiArrowDownSLine size={17} aria-hidden className="flex-none text-faint" />
      </button>
    );
  }

  return (
    <div className="mb-5">
      <Eyebrow
        action={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Свернуть"
            onClick={() => setOpen(false)}
          >
            <RiArrowUpSLine />
          </Button>
        }
      >
        Команда сейчас
        <span className="font-semibold tracking-normal text-faint">
          · {summary}
        </span>
      </Eyebrow>
      <div className="rounded-xl border border-border bg-card py-1.5">
        {shown.map((group, groupIndex) => (
          <div
            key={group.status.code}
            className={cn(
              groupIndex > 0 && "mt-1.5 border-t border-border-soft pt-2",
            )}
          >
            <GroupHeading
              status={group.status}
              count={group.users.length}
              className="mb-0.5 px-3.5"
            />
            {group.users.map((user) => (
              <PersonRow
                key={user._id}
                user={user}
                status={group.status}
                size={32}
                muted={group.status.kind === "away"}
              />
            ))}
          </div>
        ))}
        {idle.map((group) => (
          <IdleGroup
            key={group.status.code}
            status={group.status}
            users={group.users}
            size={32}
            open={!!idleOpen[group.status.code]}
            onToggle={() =>
              setIdleOpen((prev) => ({
                ...prev,
                [group.status.code]: !prev[group.status.code],
              }))
            }
            className={cn(
              (shown.length > 0 || groups[0] !== group) &&
                "mt-1.5 border-t border-border-soft pt-1",
            )}
          />
        ))}
      </div>
    </div>
  );
};

export default TeamNow;

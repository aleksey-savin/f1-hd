import { useEffect, useState } from "react";
import { Link, useFetcher, useParams } from "react-router";
import {
  RiDeleteBinLine,
  RiRestartLine,
  RiTimeLine,
  RiUserUnfollowLine,
} from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import Field from "@/components/app/Field";
import Combobox from "@/components/app/Combobox";
import DateField from "@/components/app/DateField";
import { useCrumbFrom } from "@/components/app/Crumbs";
import { useCan } from "@/store/authed-user";
import { businessDayKey, formatDate, formatDayKey } from "@/util/format-date";
import { reviewActions } from "./review-policy";
import ReviewStatusBadge from "./ReviewStatusBadge";
import { deferredDateAfter } from "./defer-date";
import { proposalReturnTo } from "./queue-navigation";
import type {
  ReviewActionResult,
  ReviewProposal,
  ReviewUser,
} from "@/types/userReview";

export const kindLabel = {
  departure: "Возможное увольнение",
  inactivity: "Давно нет активности",
  deletion: "Предложено удаление",
  unresolved: "Нужно сопоставить",
};
export { statusLabel } from "./ReviewStatusBadge";
export const proposalUser = (proposal: ReviewProposal): ReviewUser | null =>
  proposal.user ||
  (typeof proposal.userId === "object" ? proposal.userId : null);
export const proposalName = (proposal: ReviewProposal) => {
  const user = proposalUser(proposal);
  return user
    ? `${user.lastName || ""} ${user.firstName || ""}`.trim() ||
        user.email ||
        "Пользователь"
    : proposal.evidence?.[0]?.name || "Пользователь не сопоставлен";
};
type Intent = "disable" | "delete" | "restore" | "dismiss" | "defer" | "match";
const labels: Record<Intent, string> = {
  disable: "Отключить",
  delete: "Удалить",
  restore: "Восстановить",
  dismiss: "Отклонить",
  defer: "Отложить",
  match: "Выбрать пользователя",
};
const descriptions: Record<Intent, string> = {
  disable:
    "Доступ к порталу закроется, сеансы завершатся на всех устройствах. Запись пользователя и история сохранятся.",
  delete:
    "Пользователь исчезнет из рабочих списков и не сможет войти. Заявки, работы и история сохранятся.",
  restore:
    "Запись вернётся в рабочие списки. Доступ останется отключённым до отдельного включения.",
  dismiss:
    "Предложение уйдёт из очереди. Причина останется в истории проверки.",
  defer: "Предложение вернётся в очередь в указанную дату.",
  match:
    "Выберите сотрудника, о котором идёт речь в заявке. Проверьте компанию и основание.",
};
export default function ProposalDetail({
  proposal,
  showStatus = true,
}: {
  proposal: ReviewProposal;
  showStatus?: boolean;
}) {
  const can = useCan();
  const { ticketNum } = useParams();
  const origin = useCrumbFrom(
    ticketNum ? `Заявка №${ticketNum}` : "Проверка пользователей",
  );
  const fromState = origin && {
    from: {
      ...origin.from,
      to: proposalReturnTo(origin.from.to, proposal._id),
    },
  };
  const fetcher = useFetcher<ReviewActionResult>();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [reason, setReason] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [until, setUntil] = useState("");
  const [error, setError] = useState("");
  const user = proposalUser(proposal);
  const actions = reviewActions(
    {
      canManage: can({ userReview: ["manage"] }),
      canManageUsers: can({ user: ["manage"] }),
    },
    proposal,
    businessDayKey(),
  );
  const tickets = proposal.tickets || proposal.ticketIds || [];
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) setError(fetcher.data.error);
    else {
      setIntent(null);
      setError("");
    }
  }, [fetcher.state, fetcher.data]);
  const open = (next: Intent) => {
    setError("");
    setReason(proposal.reason || "");
    setUntil(actions.future || "");
    setUserId(null);
    setIntent(next);
  };
  const submit = () => {
    if (!intent) return;
    const fields: Record<string, string> = {
      intent,
      proposalId: proposal._id,
      reason,
    };
    if (userId) fields.userId = userId;
    if (until) fields.deferredUntil = until;
    fetcher.submit(fields, { method: "post", action: "/users/review" });
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{proposalName(proposal)}</h2>
        {showStatus && <ReviewStatusBadge status={proposal.status} />}
      </div>
      {user && (
        <div className="mb-5 text-sm text-muted-foreground">
          {user.company?.alias}
          {user.email && <> · {user.email}</>}
          {can({ user: ["read"] }) && (
            <Link
              to={`/users/${user._id}`}
              state={fromState}
              className="ml-2 text-accent-text"
            >
              Открыть профиль
            </Link>
          )}
        </div>
      )}
      <div className="space-y-4">
        {(proposal.evidence || []).map((evidence, index) => (
          <div key={`${evidence.ticketId || index}-${index}`}>
            <blockquote className="m-0 border-l-2 border-primary pl-4 text-sm leading-relaxed">
              {evidence.quote || proposal.reason || kindLabel[proposal.kind]}
            </blockquote>
            {evidence.effectiveDate && (
              <div className="mt-2 text-xs text-muted-foreground">
                Дата из заявки: {formatDayKey(evidence.effectiveDate)}
              </div>
            )}
            {!!evidence.systems?.length && (
              <div className="mt-2 text-xs text-muted-foreground">
                Доступы: {evidence.systems.join(", ")}
              </div>
            )}
            {!!evidence.exceptions?.length && (
              <div className="mt-2 text-sm text-warning-text">
                {evidence.exceptions.join(" · ")}
              </div>
            )}
          </div>
        ))}
      </div>
      {!!tickets.length && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tickets.map((ticket) => (
            <Link
              key={ticket._id}
              to={`/tickets/${ticket.num}`}
              state={fromState}
              className="text-sm text-accent-text"
            >
              Заявка №{ticket.num}
            </Link>
          ))}
        </div>
      )}
      {user && (
        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-border-soft pt-4 sm:grid-cols-2">
          <Fact label="Должность" value={user.position || "Не указана"} />
          <Fact
            label="Дата создания"
            value={user.createdAt ? formatDate(user.createdAt) : "Нет данных"}
          />
          <Fact
            label="Последний вход"
            value={
              user.lastLogin ? formatDate(user.lastLogin) : "Нет данных о входе"
            }
          />
          <Fact
            label="Последняя заявка"
            value={
              user.lastActivityAt
                ? formatDate(user.lastActivityAt)
                : "Нет обращений"
            }
          />
          {user.banned && (
            <Fact
              label="Отключён"
              value={
                user.disabledAt
                  ? formatDate(user.disabledAt)
                  : "Дата неизвестна"
              }
            />
          )}
          {user.deletedAt && (
            <Fact label="Удалён" value={formatDate(user.deletedAt)} />
          )}
        </div>
      )}
      {actions.future && (
        <p className="mt-4 text-sm text-warning-text">
          Дата увольнения ещё не наступила. Проверить{" "}
          {formatDayKey(actions.future)}.
        </p>
      )}
      {(actions.restricted || proposal.blockedReason) && (
        <p className="mt-4 text-sm text-warning-text">
          {proposal.blockedReason ||
            "В свидетельствах есть возвращение или ограничения на отключение. Нужно уточнить доступы."}
        </p>
      )}
      {proposal.reason && (
        <p className="mt-4 text-sm text-muted-foreground">{proposal.reason}</p>
      )}
      {proposal.decisionAt && (
        <p className="mt-3 text-xs text-faint">
          Решение: {formatDate(proposal.decisionAt)}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {actions.disable && (
          <Button variant="warning" onClick={() => open("disable")}>
            <RiUserUnfollowLine />
            Отключить
          </Button>
        )}
        {actions.delete && (
          <Button variant="destructive" onClick={() => open("delete")}>
            <RiDeleteBinLine />
            Удалить
          </Button>
        )}
        {actions.restore && (
          <Button variant="outline" onClick={() => open("restore")}>
            <RiRestartLine />
            Восстановить
          </Button>
        )}
        {actions.match && (
          <Button onClick={() => open("match")}>Выбрать пользователя</Button>
        )}
        {actions.defer && (
          <Button variant="outline" onClick={() => open("defer")}>
            <RiTimeLine />
            Проверить позже
          </Button>
        )}
        {actions.dismiss && (
          <Button variant="ghost" onClick={() => open("dismiss")}>
            Отклонить
          </Button>
        )}
      </div>
      {can({ userReview: ["manage"] }) && !can({ user: ["manage"] }) && (
        <p className="mt-4 text-xs text-muted-foreground">
          Отключение, удаление и восстановление требуют права «Изменять
          пользователей».
        </p>
      )}
      {fetcher.data?.message && !intent && (
        <p role="status" className="mt-3 text-sm text-accent-text">
          {fetcher.data.message}
        </p>
      )}
      <ConfirmDialog
        open={intent !== null}
        onOpenChange={(open) => {
          if (!open) setIntent(null);
        }}
        title={
          intent
            ? `${labels[intent]}${["disable", "delete", "restore"].includes(intent) ? ` ${proposalName(proposal)}` : ""}?`
            : ""
        }
        description={intent ? descriptions[intent] : ""}
        confirmLabel={intent ? labels[intent] : ""}
        confirmVariant={
          intent === "delete"
            ? "destructive"
            : intent === "disable"
              ? "warning"
              : "default"
        }
        isLoading={fetcher.state !== "idle"}
        confirmDisabled={
          (intent === "match" && !userId) || (intent === "defer" && !until)
        }
        onConfirm={submit}
      >
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {intent === "match" && (
          <div className="mt-4">
            <Field label="Пользователь">
              <Combobox
                value={userId}
                onChange={setUserId}
                options={(proposal.matchedCandidates || []).map(
                  (candidate) => ({
                    value: candidate._id,
                    label:
                      `${candidate.lastName || ""} ${candidate.firstName || ""}`.trim(),
                    hint: [candidate.company?.alias, candidate.email]
                      .filter(Boolean)
                      .join(" · "),
                  }),
                )}
              />
            </Field>
          </div>
        )}
        {intent === "defer" && (
          <div className="mt-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {[30, 60, 90].map((days) => (
                <Button
                  key={days}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setUntil(deferredDateAfter(businessDayKey(), days))
                  }
                >
                  Через {days} дней
                </Button>
              ))}
            </div>
            <Field label="Вернуться к проверке">
              <DateField value={until} onChange={setUntil} clearable={false} />
            </Field>
          </div>
        )}
        {intent && intent !== "restore" && (
          <div className="mt-4">
            <Field htmlFor={`review-reason-${proposal._id}`} label="Причина">
              <Textarea
                id={`review-reason-${proposal._id}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Комментарий для коллег"
              />
            </Field>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-faint">{label}</div>
      <div className="mt-1 text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

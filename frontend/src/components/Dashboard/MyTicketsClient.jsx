import { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { Eyebrow, Panel } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import { AuthedUserContext } from "../../store/authed-user-context";
import useDashboardTicketsStore from "../../store/dashboard-tickets";
import { getLocalStorageData } from "../../util/auth";
import { formatShortDate } from "../../util/format-date";
import { toIsoDay } from "../../util/period";
import { createdText } from "../Ticket/ticket-state";
import TicketRow from "./TicketRow";

/**
 * «Мои заявки» на главной клиента: открытые сверху, закрытые за месяц под
 * подзаголовком, дальше — в архив с уже проставленным фильтром.
 *
 * Закрытые здесь не ради полноты, а ради частого вопроса «что вы мне на той
 * неделе сделали»: за ним человек уходил в архив и там заново собирал фильтр.
 *
 * Сегмент «Мои | Компании» появляется только у тех, кому бэкенд отдаёт заявки
 * всей компании (`canSeeAllCompanyTickets`, сейчас это 20 человек). Остальным
 * он не сужает ничего — и по правилу «переключатель, который не сужает, не
 * показываем» его нет.
 */

const CLOSED_DAYS = 30;
const OPEN_LIMIT = 6;
const CLOSED_LIMIT = 3;

const MyTicketsClient = () => {
  const { _id: userId, permissions } = useContext(AuthedUserContext);
  const openTickets = useDashboardTicketsStore((state) => state.tickets);
  const loaded = useDashboardTicketsStore((state) => state.loaded);

  const canSeeCompany = !!permissions?.canSeeAllCompanyTickets;
  const [scope, setScope] = useState("mine");
  const [closed, setClosed] = useState([]);
  const [closedTotal, setClosedTotal] = useState(0);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - CLOSED_DAYS * 24 * 60 * 60 * 1000);
    return { from: toIsoDay(from), to: toIsoDay(to) };
  }, []);

  useEffect(() => {
    const load = async () => {
      const { token } = getLocalStorageData();
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        sort: "finished_desc",
        limit: "10",
      });
      if (!canSeeCompany) params.set("applicants", String(userId));
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/tickets/closed?${params}`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) throw new Error(`closed ${response.status}`);
        const data = await response.json();
        setClosed(data.tickets ?? []);
        setClosedTotal(data.total ?? 0);
      } catch (error) {
        // Хвост блока: не приехал — открытые заявки всё равно на месте.
        console.error("Не удалось загрузить закрытые заявки:", error);
      }
    };
    load();
  }, [userId, canSeeCompany, range.from, range.to]);

  const mine = useMemo(() => {
    if (scope === "company") return openTickets;
    return openTickets.filter(
      (ticket) => String(ticket.applicant?._id) === String(userId),
    );
  }, [openTickets, scope, userId]);

  const visibleClosed = useMemo(() => {
    if (scope === "company") return closed;
    return closed.filter(
      (ticket) => String(ticket.applicant?._id) === String(userId),
    );
  }, [closed, scope, userId]);

  // Пустой блок на лендинге не рисуется вовсе — ни заголовка, ни заглушки.
  if (!loaded) return null;
  if (mine.length === 0 && visibleClosed.length === 0) return null;

  const archiveParams = new URLSearchParams({ from: range.from, to: range.to });
  if (scope !== "company") archiveParams.set("applicants", String(userId));

  return (
    <section>
      <Eyebrow
        count={mine.length || undefined}
        action={
          <>
            {canSeeCompany && (
              <Segmented
                ariaLabel="Чьи заявки"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "mine", label: "Мои" },
                  { value: "company", label: "Компании" },
                ]}
              />
            )}
            <Link
              to={`/archive?${archiveParams}`}
              className="tw:text-sm tw:font-medium tw:text-accent-text tw:no-underline"
            >
              Все закрытые →
            </Link>
          </>
        }
      >
        Мои заявки
      </Eyebrow>

      <Panel>
        <div className="tw:-mx-5 tw:-my-5">
          {mine.slice(0, OPEN_LIMIT).map((ticket) => (
            <TicketRow
              key={ticket._id}
              ticket={ticket}
              meta={[ticket.category?.title, ticket.applicant?.lastName]
                .filter(Boolean)
                .join(" · ")}
              trailing={createdText(ticket.createdAt)}
            />
          ))}

          {visibleClosed.length > 0 && (
            <>
              <div className="tw:border-t tw:border-border-soft tw:bg-accent/45 tw:px-5 tw:py-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                Закрыты за 30 дней
                <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
                  {" "}
                  · {closedTotal}
                </span>
              </div>
              {visibleClosed.slice(0, CLOSED_LIMIT).map((ticket) => (
                <TicketRow
                  key={ticket._id}
                  ticket={{ ...ticket, state: "Закрыта" }}
                  meta={[ticket.category?.title, ticket.company?.alias]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={formatShortDate(ticket.finishedAt)}
                />
              ))}
            </>
          )}
        </div>
      </Panel>
    </section>
  );
};

export default MyTicketsClient;

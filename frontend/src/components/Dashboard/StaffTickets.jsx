import { useContext, useMemo } from "react";
import { Link } from "react-router";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { AuthedUserContext } from "../../store/authed-user-context";
import useDashboardTicketsStore from "../../store/dashboard-tickets";
import { createdText } from "../Ticket/ticket-state";
import TicketRow from "./TicketRow";
import { useCan } from "@/store/authed-user";

/**
 * Три блока сотрудника поверх одного набора открытых заявок: «На мне»,
 * «Без ответственного», «Давно без движения».
 *
 * Про сроки блока НЕТ и не будет. `deadline` в этой системе проставляется
 * автоматически как «создание + 5 часов» — он стоит у всех 13 271 заявки, и
 * формально просрочены все открытые до единой. Метрика, у которой всегда
 * максимум, перестаёт быть сигналом; вместо неё — время последнего движения.
 */

const ROWS = 5;

// «12 дней» — сколько заявка молчит. Считаем по последнему движению, а не по
// созданию: заявка недельной давности, где вчера был комментарий, живая.
const lastMovedAt = (ticket) => {
  const stamps = [
    ticket.updatedAt,
    ticket.latestComment?.createdAt,
    ticket.createdAt,
  ]
    .filter(Boolean)
    .map((value) => new Date(value).getTime());
  return stamps.length ? Math.max(...stamps) : null;
};

const silenceText = (ticket) => {
  const moved = lastMovedAt(ticket);
  if (!moved) return "";
  const days = Math.floor((Date.now() - moved) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "сегодня";
  if (days === 1) return "1 день";
  if (days < 5) return `${days} дня`;
  return `${days} дней`;
};

const companyMeta = (ticket) =>
  [ticket.company?.alias, ticket.category?.title].filter(Boolean).join(" · ");

const StaffTickets = () => {
  const { _id: userId, isAdmin } = useContext(AuthedUserContext);
  const can = useCan();
  const tickets = useDashboardTicketsStore((state) => state.tickets);
  const loaded = useDashboardTicketsStore((state) => state.loaded);

  // Ничейные заявки видит только тот, кому бэкенд вообще отдаёт чужие: у
  // остальных набор физически состоит из их собственных, и блок был бы пуст
  // всегда (см. скоуп all-opened в controllers/ticket.js).
  const seesOthers =
    isAdmin ||
    !!can({ ticket: ["administrate"] }) ||
    !!can({ ticket: ["readAll"] });

  const mine = useMemo(
    () =>
      tickets.filter((ticket) =>
        (ticket.responsibles ?? []).some(
          (user) => String(user?._id) === String(userId),
        ),
      ),
    [tickets, userId],
  );

  const unassigned = useMemo(
    () =>
      seesOthers ? tickets.filter((t) => !(t.responsibles ?? []).length) : [],
    [tickets, seesOthers],
  );

  // Машинные заявки (мониторинг, антивирус, отчёты бэкапов) держим отдельным
  // счётчиком: их большинство, и без разделения «19 ничейных» читается как
  // «команда не разгребает», хотя людских там семь.
  const [fromPeople, fromMachines] = useMemo(() => {
    const machine = (ticket) =>
      ticket.isAuto ||
      ticket.source === "Мониторинг устройств" ||
      !ticket.applicant;
    return [
      unassigned.filter((ticket) => !machine(ticket)),
      unassigned.filter(machine),
    ];
  }, [unassigned]);

  const stale = useMemo(
    () =>
      [...tickets]
        .sort((a, b) => (lastMovedAt(a) ?? 0) - (lastMovedAt(b) ?? 0))
        .slice(0, ROWS),
    [tickets],
  );

  if (!loaded) return null;

  return (
    <>
      {mine.length > 0 && (
        <section>
          <Eyebrow
            count={mine.length}
            action={
              <Link
                to="/tickets"
                className="text-sm font-medium text-accent-text no-underline"
              >
                Все заявки →
              </Link>
            }
          >
            На мне
          </Eyebrow>
          <Panel>
            <div className="-mx-5 -my-5">
              {mine.slice(0, ROWS).map((ticket) => (
                <TicketRow
                  key={ticket._id}
                  ticket={ticket}
                  meta={companyMeta(ticket)}
                  trailing={createdText(ticket.createdAt)}
                />
              ))}
            </div>
          </Panel>
        </section>
      )}

      {unassigned.length > 0 && (
        <section>
          <Eyebrow
            count={unassigned.length}
            action={
              <span className="text-sm text-muted-foreground tabular-nums">
                от людей {fromPeople.length} · от мониторинга{" "}
                {fromMachines.length}
              </span>
            }
          >
            Без ответственного
          </Eyebrow>
          <Panel>
            <div className="-mx-5 -my-5">
              {/* Сначала то, за чем стоит человек: машинные заявки разбирают
                  пачкой и не срочно. */}
              {[...fromPeople, ...fromMachines].slice(0, ROWS).map((ticket) => (
                <TicketRow
                  key={ticket._id}
                  ticket={ticket}
                  meta={[companyMeta(ticket), ticket.source]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={createdText(ticket.createdAt)}
                />
              ))}
            </div>
          </Panel>
        </section>
      )}

      {stale.length > 0 && (
        <section>
          <Eyebrow count={stale.length}>Давно без движения</Eyebrow>
          <Panel>
            <div className="-mx-5 -my-5">
              {stale.map((ticket) => (
                <TicketRow
                  key={ticket._id}
                  ticket={ticket}
                  meta={companyMeta(ticket)}
                  trailing={
                    <span className="text-destructive">
                      {silenceText(ticket)}
                    </span>
                  }
                />
              ))}
            </div>
          </Panel>
        </section>
      )}
    </>
  );
};

export default StaffTickets;

import { Link } from "@/components/app/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { MultiCombobox } from "@/components/app/Combobox";
import { Button } from "@/components/ui/button";
import { useAuthedUser } from "@/store/authed-user";
import { formatDate } from "@/util/format-date";
import { directAllocationTickets } from "./allocation-state";
import type { TaxiActionResult, TaxiTrip } from "@/types/taxi";

interface ClosingTicket {
  _id: string;
  num: number;
  company?: { _id: string; alias?: string };
}
function TicketCandidates({
  ticket,
  onResult,
}: {
  ticket: ClosingTicket;
  onResult: (ticketId: string, trips: TaxiTrip[]) => void;
}) {
  const fetcher = useFetcher<TaxiActionResult>();
  const { submit } = fetcher;
  useEffect(() => {
    submit(
      {
        intent: "ticket-candidates",
        payload: JSON.stringify({ ticketId: ticket._id }),
      },
      { method: "post", action: "/report/taxi" },
    );
  }, [ticket._id, submit]);
  useEffect(() => {
    if (fetcher.data?.trips) onResult(ticket._id, fetcher.data.trips);
  }, [ticket._id, fetcher.data, onResult]);
  return fetcher.data?.error ? (
    <p className="my-1 text-sm text-muted-foreground">
      Не удалось проверить такси по заявке {ticket.num}. Заявку можно закрыть.{" "}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={fetcher.state !== "idle"}
        onClick={() =>
          submit(
            {
              intent: "ticket-candidates",
              payload: JSON.stringify({ ticketId: ticket._id }),
            },
            { method: "post", action: "/report/taxi" },
          )
        }
      >
        Повторить
      </Button>
    </p>
  ) : null;
}
function RideBinding({
  trip,
  tickets,
  onSaved,
}: {
  trip: TaxiTrip;
  tickets: ClosingTicket[];
  onSaved: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const fetcher = useFetcher<TaxiActionResult>();
  useEffect(() => {
    if (fetcher.data?.ok) onSaved(trip._id);
  }, [fetcher.data, onSaved, trip._id]);
  return (
    <div className="space-y-2 border-t border-border-soft py-3">
      <div className="text-sm font-medium">
        {trip.companyName} · {trip.personName}
      </div>
      <Link to={`/taxi/trips/${trip._id}`} className="text-sm text-accent-text">
        {trip.startedAt
          ? formatDate(trip.startedAt)
          : trip.requestedAt
            ? `Заказ на ${formatDate(trip.requestedAt)}`
            : "Дата уточняется"}{" "}
        · {trip.destination?.address || "Место уточняется"}
      </Link>
      <MultiCombobox
        value={selected}
        onChange={setSelected}
        disabled={fetcher.state !== "idle"}
        placeholder="Выберите заявки, выполненные в этот выезд"
        ariaLabel="Связать поездку с заявками"
        options={tickets.map((ticket) => ({
          value: ticket._id,
          label: `${ticket.num}`,
        }))}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!selected.length || fetcher.state !== "idle"}
        onClick={() =>
          fetcher.submit(
            {
              intent: "allocation",
              payload: JSON.stringify({
                id: trip._id,
                companyId: trip.companyId,
                purpose: trip.purpose,
                ticketIds: directAllocationTickets(
                  trip.directTicketIds,
                  selected,
                ),
              }),
            },
            { method: "post", action: "/report/taxi" },
          )
        }
      >
        Связать поездку
      </Button>
      {fetcher.data?.error && (
        <p role="alert" className="my-0 text-sm text-destructive">
          {fetcher.data.error}
        </p>
      )}
    </div>
  );
}

export default function ClosingReminder({
  tickets,
}: {
  tickets: ClosingTicket[];
}) {
  const me = useAuthedUser();
  const [results, setResults] = useState<Record<string, TaxiTrip[]>>({});
  const [done, setDone] = useState<string[]>([]);
  const onResult = useCallback(
    (id: string, trips: TaxiTrip[]) =>
      setResults((current) => ({ ...current, [id]: trips })),
    [],
  );
  const onSaved = useCallback(
    (id: string) => setDone((current) => [...current, id]),
    [],
  );
  const trips = useMemo(
    () =>
      [
        ...new Map(
          Object.values(results)
            .flat()
            .map((trip) => [trip._id, trip]),
        ).values(),
      ]
        .filter(
          (trip) =>
            !done.includes(trip._id) &&
            tickets.some(
              (ticket) =>
                results[ticket._id]?.some((row) => row._id === trip._id) &&
                !trip.ticketIds.includes(ticket._id),
            ),
        )
        .sort((a, b) =>
          `${a.companyName}:${a.personName}`.localeCompare(
            `${b.companyName}:${b.personName}`,
            "ru",
          ),
        ),
    [results, done, tickets],
  );
  if (me.isEndUser) return null;
  return (
    <div className="my-3">
      {tickets.map((ticket) => (
        <TicketCandidates
          key={ticket._id}
          ticket={ticket}
          onResult={onResult}
        />
      ))}
      {!!trips.length && (
        <div className="rounded-lg border border-border bg-accent p-3">
          <p className="my-0 text-sm font-medium">
            Есть поездки по датам выездных работ
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Укажите заявки этого выезда или выберите поездку в форме работы. Это
            не мешает закрытию.
          </p>
          {trips.map((trip) => {
            const available = tickets.filter(
              (ticket) =>
                results[ticket._id]?.some((row) => row._id === trip._id) &&
                !trip.ticketIds.includes(ticket._id),
            );
            if (!available.length) return null;
            if (trip.canAllocate)
              return (
                <RideBinding
                  key={trip._id}
                  trip={trip}
                  tickets={available}
                  onSaved={onSaved}
                />
              );
            return (
              <div key={trip._id} className="text-sm">
                {trip.companyName} · {trip.personName}
                {available.map((ticket) => (
                  <Link
                    key={ticket._id}
                    className="ml-2 text-accent-text"
                    to={`/tickets/${ticket.num}#ticket-works`}
                  >
                    Работы по заявке {ticket.num}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

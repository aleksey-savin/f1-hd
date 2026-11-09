import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { Eyebrow, Panel, Section } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/util/format-date";
import type { TaxiActionResult } from "@/types/taxi";

export default function TicketExpenses({ ticketId }: { ticketId: string }) {
  const fetcher = useFetcher<TaxiActionResult>();
  const { submit } = fetcher;
  useEffect(() => {
    submit(
      { intent: "ticket-trips", payload: JSON.stringify({ ticketId }) },
      { method: "post", action: "/report/taxi" },
    );
  }, [ticketId, submit]);
  if (!fetcher.data?.trips?.length && !fetcher.data?.error) return null;
  return (
    <Section>
      <Eyebrow id="ticket-taxi">Расходы на такси</Eyebrow>
      <Panel>
        {fetcher.data?.error && (
          <p role="alert" className="text-sm text-destructive">
            {fetcher.data.error}{" "}
            <Button
              size="sm"
              variant="outline"
              disabled={fetcher.state !== "idle"}
              onClick={() =>
                submit(
                  {
                    intent: "ticket-trips",
                    payload: JSON.stringify({ ticketId }),
                  },
                  { method: "post", action: "/report/taxi" },
                )
              }
            >
              Повторить
            </Button>
          </p>
        )}
        <div className="divide-y divide-border-soft">
          {fetcher.data?.trips?.map((trip) => (
            <div key={trip._id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap justify-between gap-2">
                <Link
                  className="font-medium text-accent-text"
                  to={`/taxi/trips/${trip._id}`}
                >
                  {trip.startedAt
                    ? formatDate(trip.startedAt)
                    : trip.requestedAt
                      ? `Заказ на ${formatDate(trip.requestedAt)}`
                      : "Дата уточняется"}{" "}
                  · {trip.personName}
                </Link>
                <span className="tabular-nums">
                  {trip.totalMinor == null
                    ? trip.estimateMinor == null
                      ? "Стоимость ожидается"
                      : `≈ ${(trip.estimateMinor / 100).toLocaleString("ru-RU")} ₽`
                    : `${(trip.totalMinor / 100).toLocaleString("ru-RU")} ₽`}
                </span>
              </div>
              <div className="text-sm">
                {trip.origin?.address || "—"} →{" "}
                {trip.destination?.address || "—"}
              </div>
              {!!trip.tickets.filter((ticket) => ticket._id !== ticketId)
                .length && (
                <p className="my-0 text-sm text-muted-foreground">
                  В рамках этого выезда выполнены работы также по заявкам{" "}
                  {trip.tickets
                    .filter((ticket) => ticket._id !== ticketId)
                    .map((ticket, index) => (
                      <span key={ticket._id}>
                        {index > 0 && ", "}
                        <Link
                          className="text-accent-text"
                          to={`/tickets/${ticket.num}`}
                        >
                          №{ticket.num}
                        </Link>
                      </span>
                    ))}
                  .
                </p>
              )}
              <p className="my-0 text-sm text-muted-foreground">
                Сумма общая для выезда. В расходах компании поездка учитывается
                один раз.
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </Section>
  );
}

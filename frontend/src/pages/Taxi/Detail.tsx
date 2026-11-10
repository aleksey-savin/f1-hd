import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData, useParams } from "react-router";
import PageShell from "@/components/app/PageShell";
import { Panel } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/util/format-date";
import { taxiPurposeLabel } from "@/components/Taxi/purpose";
import { formatPhone, phoneHref } from "@/util/phone";
import type { TaxiDetail } from "@/types/taxi";

const statusLabel: Record<string, string> = {
  new: "Создан",
  pending: "Создаётся",
  searching: "Ищем машину",
  driving: "Водитель едет к вам",
  waiting: "Водитель ожидает",
  transporting: "В пути",
  finished: "Поездка завершена",
  complete: "Поездка завершена",
  cancelled: "Заказ отменён",
  canceled: "Заказ отменён",
  failed: "Не удалось выполнить заказ",
};

export default function TaxiTripDetail() {
  const initial = useLoaderData() as TaxiDetail;
  const { id } = useParams();
  const poll = useFetcher<TaxiDetail & { error?: string }>();
  const [detail, setDetail] = useState(initial);
  useEffect(() => {
    setDetail(initial);
  }, [initial]);
  useEffect(() => {
    const data = poll.data;
    if (data?.trip && data.trip._id === id) setDetail(data);
  }, [poll.data, id]);
  const trip = detail.trip;
  const terminal = [
    "finished",
    "cancelled",
    "canceled",
    "failed",
    "complete",
  ].includes(trip.status);
  const { load } = poll;
  useEffect(() => {
    if (terminal || !id) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        load(`/taxi/trips/${id}/status`);
    }, 15000);
    return () => clearInterval(timer);
  }, [id, load, terminal]);
  const refresh = () => load(`/taxi/trips/${id}/status`);
  return (
    <PageShell
      title="Поездка на такси"
      subtitle={trip.personName || "Сотрудник не сопоставлен"}
      breadcrumb={
        <Link to="/report/taxi" className="text-sm text-accent-text">
          ← Такси
        </Link>
      }
      action={
        <Button
          variant="outline"
          disabled={poll.state !== "idle"}
          onClick={refresh}
        >
          Обновить
        </Button>
      }
    >
      <div className="max-w-2xl">
        <Panel>
          <div className="space-y-4">
            <p className="my-0 font-medium">
              {statusLabel[trip.status] || trip.status}
            </p>
            <div>
              <div className="text-sm text-muted-foreground">Маршрут</div>
              {trip.origin?.address || "Отправление уточняется"} →{" "}
              {trip.destination?.address || "Назначение уточняется"}
            </div>
            <p className="my-0 text-sm">
              {trip.startedAt
                ? `Начало поездки: ${formatDate(trip.startedAt)}`
                : trip.requestedAt
                  ? `Заказ на ${formatDate(trip.requestedAt)}`
                  : "Фактическое время начала пока неизвестно"}
              {trip.finishedAt && (
                <> · Завершена: {formatDate(trip.finishedAt)}</>
              )}
            </p>
            <div>
              <div className="text-sm text-muted-foreground">
                Компания и назначение
              </div>
              {trip.companyName || "Компания не указана"} ·{" "}
              {taxiPurposeLabel(trip.purpose)}
            </div>
            {!!trip.tickets.length && (
              <div className="flex flex-wrap gap-2">
                {trip.tickets.map((ticket) => (
                  <Link
                    key={ticket._id}
                    className="text-accent-text"
                    to={`/tickets/${ticket.num}`}
                  >
                    №{ticket.num} · {ticket.title}
                  </Link>
                ))}
              </div>
            )}
            <div>
              <div className="text-sm text-muted-foreground">
                {trip.totalMinor == null
                  ? "Предварительная стоимость"
                  : "Стоимость поездки"}
              </div>
              {trip.totalMinor == null && trip.estimateMinor == null
                ? "Ожидается"
                : `${trip.totalMinor == null ? "≈ " : ""}${((trip.totalMinor ?? trip.estimateMinor ?? 0) / 100).toLocaleString("ru-RU")} ${trip.currency || "RUB"}`}
              <p className="my-1 text-sm text-muted-foreground">
                Сумма общая для выезда. В расходах компании поездка учитывается
                один раз.
              </p>
            </div>
            {trip.driver && (
              <div className="rounded-lg bg-accent p-3">
                <div className="font-medium">
                  {trip.driver.car || "Автомобиль уточняется"}{" "}
                  {trip.driver.number}
                </div>
                <div>
                  {trip.driver.name || "Водитель уточняется"}
                  {trip.driver.phone && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        className="text-accent-text"
                        href={phoneHref(trip.driver.phone)}
                      >
                        {formatPhone(trip.driver.phone)}
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
            {poll.data?.error && (
              <p role="alert" className="text-sm text-destructive">
                {poll.data.error} Показаны последние полученные сведения.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}

import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Field from "@/components/app/Field";
import { MultiCombobox } from "@/components/app/Combobox";
import { Button } from "@/components/ui/button";
import { formatDate, localToUtc } from "@/util/format-date";
import type { TaxiActionResult, TaxiTrip } from "@/types/taxi";

interface WorkTripForm {
  isPlan: boolean;
  visitRequired: boolean;
  startedAt: string;
  finishedAt: string;
  performerId: string;
  companyId: string;
  allTicketIds: string[];
  taxiTripIds: string[];
  taxiDecision: string;
  setTaxiTripIds: (ids: string[]) => void;
  setNoTaxi: () => void;
}

export default function WorkTrips({ form }: { form: WorkTripForm }) {
  const fetcher = useFetcher<TaxiActionResult>();
  const { submit } = fetcher;
  const [known, setKnown] = useState<Record<string, TaxiTrip>>({});
  const eligible = !form.isPlan && form.visitRequired;
  const payload =
    eligible &&
    form.startedAt &&
    form.finishedAt &&
    form.companyId &&
    form.performerId
      ? JSON.stringify({
          companyId: form.companyId,
          tickets: form.allTicketIds,
          performerId: form.performerId,
          startedAt: localToUtc(form.startedAt),
          finishedAt: localToUtc(form.finishedAt),
        })
      : "";
  useEffect(() => {
    if (!payload) return;
    const timer = setTimeout(
      () =>
        submit(
          { intent: "candidates", payload, candidateKey: payload },
          { method: "post", action: "/report/taxi" },
        ),
      400,
    );
    return () => clearTimeout(timer);
  }, [payload, submit]);
  useEffect(() => {
    if (fetcher.data?.candidateKey !== payload || !fetcher.data?.trips) return;
    setKnown((current) => ({
      ...current,
      ...Object.fromEntries(
        fetcher.data?.trips?.map((trip) => [trip._id, trip]) || [],
      ),
    }));
  }, [fetcher.data, payload]);
  if (!eligible) return null;
  const current = fetcher.data?.candidateKey === payload ? fetcher.data : null;
  const optionIds = [
    ...new Set([
      ...(current?.trips || []).map((trip) => trip._id),
      ...form.taxiTripIds,
    ]),
  ];
  return (
    <Field
      label="Такси в рамках выезда"
      htmlFor="work-taxi-trips"
      hint="Выберите поездки, относящиеся к фактическим работам. Одна поездка может быть общей для нескольких работ и заявок."
    >
      {!payload ? (
        <p className="text-sm text-muted-foreground">
          Подходящие поездки появятся после указания времени работы.
        </p>
      ) : (
        <>
          <MultiCombobox
            id="work-taxi-trips"
            value={form.taxiTripIds}
            onChange={form.setTaxiTripIds}
            disabled={fetcher.state !== "idle"}
            options={optionIds.map((tripId) => {
              const trip =
                (current?.trips || []).find((row) => row._id === tripId) ||
                known[tripId];
              const moment = trip?.finishedAt || trip?.startedAt;
              const when = moment
                ? formatDate(moment)
                : trip?.requestedAt
                  ? `Заказ на ${formatDate(trip.requestedAt)}`
                  : "Дата уточняется";
              return {
                value: tripId,
                label: trip
                  ? `${when} · ${trip.destination?.address || "Адрес уточняется"}`
                  : "Ранее выбранная поездка",
                hint: trip?.tickets.length
                  ? `Также связана с заявками ${trip.tickets.map((ticket) => `№${ticket.num}`).join(", ")}`
                  : undefined,
              };
            })}
            placeholder={
              optionIds.length
                ? "Выберите поездки"
                : "Подходящих поездок пока нет"
            }
          />
          {current?.error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {current.error}
            </p>
          )}
        </>
      )}
      <Button
        className="mt-2"
        type="button"
        variant={
          form.taxiDecision === "none" && !form.taxiTripIds.length
            ? "secondary"
            : "ghost"
        }
        size="sm"
        onClick={form.setNoTaxi}
      >
        Без корпоративного такси
      </Button>
    </Field>
  );
}

import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Combobox, { MultiCombobox } from "@/components/app/Combobox";
import {
  directAllocationTickets,
  allocationCandidates,
} from "./allocation-state";
import {
  defaultTaxiPurpose,
  taxiPurposeOptions,
  normalizeTaxiPurpose,
} from "./purpose";
import { Link } from "react-router";
import Field from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { TaxiActionResult, TaxiCompany, TaxiTrip } from "@/types/taxi";
import { formatDate } from "@/util/format-date";
import { formatTaxiAddress } from "./address";

export default function AllocationDialog({
  trip,
  companies,
  remaining = 1,
  onSaved,
  onClose,
}: {
  trip: TaxiTrip;
  companies: TaxiCompany[];
  remaining?: number;
  onSaved: (trip?: TaxiTrip) => void;
  onClose: () => void;
}) {
  const [companyId, setCompanyId] = useState(trip.companyId || "");
  const [ticketIds, setTicketIds] = useState(() =>
    directAllocationTickets(trip.directTicketIds),
  );
  const [purpose, setPurpose] = useState(trip.purpose);
  const fetcher = useFetcher<TaxiActionResult>();
  const options = useFetcher<TaxiActionResult>();
  const { submit } = options;
  useEffect(() => {
    if (companyId)
      submit(
        {
          intent: "allocation-options",
          payload: JSON.stringify({ companyId, tripId: trip._id }),
        },
        { method: "post", action: "/report/taxi" },
      );
  }, [companyId, trip._id, submit]);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok)
      onSaved(fetcher.data.trip);
  }, [fetcher.state, fetcher.data, onSaved]);
  const candidates = allocationCandidates(
    trip,
    companyId,
    options.data?.allocationOptions,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Привязка поездки{remaining > 1 && ` · осталось ${remaining}`}
          </DialogTitle>
          <DialogDescription>
            Компания определяет учёт расходов. Заявок может быть несколько;
            внутренние поездки могут оставаться без заявки.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border bg-accent p-3 text-sm">
          <b>{trip.personName}</b>
          <br />
          {trip.startedAt
            ? formatDate(trip.startedAt)
            : trip.requestedAt
              ? `Заказ на ${formatDate(trip.requestedAt)}`
              : "Дата уточняется"}
          <br />
          {formatTaxiAddress(trip.origin?.address) || "—"} →{" "}
          {formatTaxiAddress(trip.destination?.address) || "—"}
        </div>
        {!!trip.workIds.length && (
          <p className="text-sm text-muted-foreground">
            Связи поездки, указанные в работах, изменяются в формах этих работ.
            Этот диалог изменяет дополнительные связи с заявками.
          </p>
        )}
        <Field label="Компания" htmlFor="taxi-allocation-company" required>
          <Combobox
            id="taxi-allocation-company"
            value={companyId || null}
            options={companies.map((company) => ({
              value: company._id,
              label: company.alias,
            }))}
            onChange={(value) => {
              setCompanyId(value || "");
              setTicketIds([]);
              setPurpose(defaultTaxiPurpose(value || "", companies));
            }}
            placeholder="Выберите компанию"
          />
        </Field>
        <Field label="Назначение поездки" htmlFor="taxi-allocation-purpose">
          <Combobox
            id="taxi-allocation-purpose"
            value={purpose}
            options={taxiPurposeOptions}
            onChange={(value) => {
              setPurpose(normalizeTaxiPurpose(value || "unknown"));
              if (value === "personal") setTicketIds([]);
            }}
          />
        </Field>
        <Field
          label="Заявки"
          htmlFor="taxi-allocation-tickets"
          hint={
            purpose === "personal"
              ? "Личная поездка не связывается с заявками."
              : !trip.userId
                ? "Сначала сопоставьте сотрудника поездки с HD. Ранее сохранённые связи доступны ниже."
                : "Заявки выбранной компании, где сотрудник поездки — ответственный. Ранее сохранённые связи остаются доступны."
          }
        >
          <MultiCombobox
            id="taxi-allocation-tickets"
            ariaLabel="Заявки"
            value={ticketIds}
            onChange={setTicketIds}
            disabled={
              !companyId || purpose === "personal" || options.state !== "idle"
            }
            options={candidates.map((ticket) => ({
              value: ticket._id,
              label: `№${ticket.num} · ${ticket.title}`,
              disabled:
                trip.workTicketIds.includes(ticket._id) &&
                !trip.directTicketIds.includes(ticket._id),
              hint: trip.workTicketIds.includes(ticket._id)
                ? "Связана через работу"
                : undefined,
            }))}
            placeholder="Выберите заявки"
          />
        </Field>
        {!!trip.workTicketIds.length && (
          <div className="text-sm text-muted-foreground">
            Связаны через работы:{" "}
            {trip.tickets
              .filter((ticket) => trip.workTicketIds.includes(ticket._id))
              .map((ticket, index) => (
                <span key={ticket._id}>
                  {index > 0 && ", "}
                  <Link
                    to={`/tickets/${ticket.num}#ticket-works`}
                    className="text-accent-text"
                  >
                    №{ticket.num}
                  </Link>
                </span>
              ))}
            . Эти связи сохранятся, пока поездка указана в работах.
          </div>
        )}
        {(fetcher.data?.error || options.data?.error) && (
          <p role="alert" className="text-sm text-destructive">
            {fetcher.data?.error || options.data?.error}
          </p>
        )}
        <DialogFooter>
          {remaining > 1 && (
            <Button
              variant="ghost"
              onClick={() => onSaved()}
              disabled={fetcher.state !== "idle"}
            >
              Пропустить
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            disabled={!companyId || fetcher.state !== "idle"}
            onClick={() => {
              fetcher.submit(
                {
                  intent: "allocation",
                  payload: JSON.stringify({
                    id: trip._id,
                    companyId,
                    purpose,
                    ticketIds,
                  }),
                },
                { method: "post", action: "/report/taxi" },
              );
            }}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

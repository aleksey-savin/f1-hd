import { useCallback, useState } from "react";
import {
  Link,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
  useActionData,
} from "react-router";
import {
  RiFilter3Line,
  RiMoreLine,
  RiEdit2Line,
  RiDeleteBinLine,
} from "react-icons/ri";
import { isMobile } from "react-device-detect";

import Combobox from "@/components/app/Combobox";
import AlertMessage from "@/components/app/AlertMessage";
import DateRangeField from "@/components/app/DateRangeField";
import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import MonthStepper from "@/components/app/MonthStepper";
import Pager from "@/components/app/Pager";
import Segmented from "@/components/app/Segmented";
import SwitchField from "@/components/app/SwitchField";
import PageShell from "@/components/app/PageShell";
import StatTile from "@/components/app/StatTile";
import AllocationDialog from "@/components/Taxi/AllocationDialog";
import { taxiPurposeLabel } from "@/components/Taxi/purpose";
import { DeleteDialog } from "@/components/app/DeleteItem";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import EmptyReport from "@/components/Report/EmptyReport";
import FilterSheet from "@/components/Report/FilterSheet";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCan } from "@/store/authed-user";
import { formatDate } from "@/util/format-date";
import type {
  TaxiReportData,
  TaxiReportResult,
  TaxiTrip,
  TaxiActionResult,
} from "@/types/taxi";
import { cn } from "@/lib/utils";
import { isFullMonthRange, monthRange } from "@/util/period";
import {
  changeReportQuery,
  mergeReportPage,
  updateReportTrip,
} from "./report-state";

const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(value / 100);

function TripActions({
  trip,
  onAllocate,
}: {
  trip: TaxiTrip;
  onAllocate: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  if (!trip.canAllocate && !trip.canDelete) return null;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Действия"
            title="Действия"
            className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          >
            <RiMoreLine />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {trip.canAllocate && (
            <DropdownMenuItem onSelect={onAllocate}>
              <RiEdit2Line />
              {trip.companyId ? "Изменить привязку" : "Указать компанию"}
            </DropdownMenuItem>
          )}
          {trip.canDelete && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <RiDeleteBinLine />
              Удалить
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {trip.canDelete && (
        <DeleteDialog
          item={{ _id: trip._id, title: "Удалить поездку?" }}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          customDeleteMessage="Поездка и её расход будут удалены из HD и не появятся при синхронизации. Заказ в Яндекс Go сохраняется."
        />
      )}
    </>
  );
}

export default function TaxiReport() {
  const result = useLoaderData() as TaxiReportResult;
  const [retained, setRetained] = useState<TaxiReportData | null>(
    result.report || null,
  );
  const retry = useRevalidator();
  if (result.report && result.report !== retained) setRetained(result.report);
  const data = result.report || retained;
  if (!data)
    return (
      <PageShell title="Такси">
        <AlertMessage
          variant="danger"
          message={
            <div className="flex flex-wrap items-center gap-3">
              {result.error}
              <Button
                variant="outline"
                disabled={retry.state !== "idle"}
                onClick={() => retry.revalidate()}
              >
                Повторить
              </Button>
            </div>
          }
        />
      </PageShell>
    );
  return <TaxiReportView data={data} error={result.error} />;
}

function TaxiReportView({
  data,
  error,
}: {
  data: TaxiReportData;
  error?: string;
}) {
  const can = useCan();
  const action = useActionData() as TaxiActionResult | undefined;
  const navigation = useNavigation();
  const retry = useRevalidator();
  const busy = navigation.state !== "idle" || retry.state !== "idle";
  const [query, setQuery] = useSearchParams();
  const [queue, setQueue] = useState<TaxiTrip[]>([]);
  const filterSheet = useMobileFilterOffcanvasStore();
  const next = useCallback(() => setQueue((current) => current.slice(1)), []);
  const close = useCallback(() => setQueue([]), []);
  const change = (key: string, value: string) => {
    setQuery(changeReportQuery(query, { [key]: value }));
  };
  const defaultPeriod = data.period || monthRange(new Date());
  const period = {
    from: query.get("from") || defaultPeriod.from,
    to: query.get("to") || defaultPeriod.to,
  };
  const filterActive =
    !isFullMonthRange(period.from, period.to) ||
    ["companyId", "userId", "unassigned", "withoutTicket"].some((key) =>
      query.has(key),
    );
  const reset = () =>
    setQuery(
      query.get("scope") === "all"
        ? { scope: "all", ...monthRange(new Date()) }
        : monthRange(new Date()),
    );
  const page = Math.max(1, Number(query.get("page")) || 1);
  const filters = new URLSearchParams(query);
  filters.delete("page");
  const currentPage = { key: filters.toString(), page, trips: data.trips };
  const deletedTripId = action?.deletedTripId;
  const [loaded, setLoaded] = useState({
    data,
    view: currentPage,
    deletedTripId,
  });
  const view =
    loaded.deletedTripId !== deletedTripId
      ? currentPage
      : loaded.data === data
        ? loaded.view
        : mergeReportPage(loaded.view, currentPage, isMobile);
  if (loaded.data !== data || loaded.deletedTripId !== deletedTripId)
    setLoaded({ data, view, deletedTripId });
  const saved = useCallback(
    (trip?: TaxiTrip) => {
      if (trip)
        setLoaded((current) => ({
          ...current,
          view: updateReportTrip(current.view, trip, query),
        }));
      next();
    },
    [next, query],
  );
  const unassigned = view.trips.filter(
    (trip) => !trip.companyId && trip.canAllocate,
  );
  return (
    <PageShell
      title="Такси"
      subtitle="Корпоративные поездки и расходы"
      toolbar={
        <>
          {can({ taxi: ["read"] }) && (
            <Segmented
              fit
              ariaLabel="Область отчёта"
              value={query.get("scope") || "own"}
              onChange={(value) => change("scope", value)}
              options={[
                { value: "own", label: "Мои поездки" },
                { value: "all", label: "Все поездки" },
              ]}
            />
          )}
          <MonthStepper
            {...period}
            onChange={(range) => setQuery(changeReportQuery(query, range))}
          />
          <Button
            variant={filterActive ? "success" : "outline"}
            size="icon"
            aria-label="Фильтр"
            title="Фильтр"
            onClick={filterSheet.handleShow}
          >
            <RiFilter3Line />
          </Button>
        </>
      }
    >
      <div
        className={cn(
          "flex flex-col gap-6 transition-opacity",
          busy && "opacity-60",
        )}
        aria-busy={busy}
      >
        {action?.error && (
          <AlertMessage
            variant="danger"
            className="my-0"
            message={action.error}
          />
        )}
        {error && (
          <AlertMessage
            variant="danger"
            className="my-0"
            message={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  {error}
                  <div>Показаны последние успешно загруженные данные.</div>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => retry.revalidate()}
                >
                  Повторить
                </Button>
              </div>
            }
          />
        )}
        {!data.isActive && (
          <AlertMessage
            variant="info"
            className="my-0"
            message={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    Корпоративное такси выключено
                  </div>
                  <div>
                    Сохранённые расходы доступны. Новые поездки появятся после
                    включения интеграции.
                  </div>
                </div>
              </div>
            }
          />
        )}
        {view.trips.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Расходы по фильтру"
              value={money(data.totalMinor)}
              footer="Каждая поездка учтена один раз"
            />
            <StatTile
              label="Поездки"
              value={data.total}
              footer="По выбранному периоду и фильтрам"
            />
            <StatTile
              label="Предварительная стоимость"
              value={money(data.estimatedMinor || 0)}
              footer="Для поездок без окончательного расчёта"
            />
          </div>
        )}
        {unassigned.length > 1 && (
          <Button variant="outline" onClick={() => setQueue(unassigned)}>
            Указать компании · {unassigned.length}
          </Button>
        )}
        {view.trips.length === 0 ? (
          <EmptyReport
            title={
              filterActive ? "Поездки не найдены" : "Нет поездок за период"
            }
            hint={
              filterActive
                ? "Измените условия в фильтре или выберите другой период."
                : "Выберите другой месяц. Новые поездки появятся после синхронизации с Яндекс Go."
            }
            action={
              <Button variant="outline" onClick={reset}>
                {filterActive ? "Сбросить фильтр" : "Текущий месяц"}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card px-2 py-1.5">
            <Table className="min-w-[640px] table-fixed">
              <colgroup>
                <col />
                <col className="w-[24%]" />
                <col className="w-[14%]" />
                <col className="w-28" />
                <col className="w-14" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>Поездка</TableHead>
                  <TableHead className="whitespace-normal">
                    Сотрудник и компания
                  </TableHead>
                  <TableHead>Заявки</TableHead>
                  <TableHead className="text-right">Расход</TableHead>
                  <TableHead>
                    <span className="sr-only">Действия</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.trips.map((trip) => (
                  <TableRow key={trip._id} className="group [&>td]:py-4">
                    <TableCell className="align-middle whitespace-normal break-words">
                      <Link
                        className="font-medium text-accent-text"
                        to={`/taxi/trips/${trip._id}`}
                      >
                        {trip.startedAt
                          ? formatDate(trip.startedAt)
                          : trip.requestedAt
                            ? `Заказ на ${formatDate(trip.requestedAt)}`
                            : "Дата уточняется"}
                      </Link>
                      <dl className="mt-2 mb-0 space-y-1.5 text-sm">
                        <div className="flex items-baseline gap-3">
                          <dt className="w-14 shrink-0 text-muted-foreground">
                            Откуда
                          </dt>
                          <dd className="m-0 min-w-0 flex-1 leading-relaxed text-foreground">
                            {trip.origin?.address || "—"}
                          </dd>
                        </div>
                        <div className="flex items-baseline gap-3">
                          <dt className="w-14 shrink-0 text-muted-foreground">
                            Куда
                          </dt>
                          <dd className="m-0 min-w-0 flex-1 leading-relaxed text-foreground">
                            {trip.destination?.address || "—"}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-3 text-xs text-muted-foreground">
                        {trip.source === "go" ? "Яндекс Go" : "HD"}
                        {" · "}
                        {taxiPurposeLabel(trip.purpose)}
                      </div>
                    </TableCell>
                    <TableCell className="align-middle whitespace-normal break-words">
                      <div>{trip.personName || "Сотрудник не сопоставлен"}</div>
                      <div className="text-xs text-muted-foreground">
                        {trip.companyName || "Компания не указана"}
                      </div>
                    </TableCell>
                    <TableCell className="align-middle whitespace-normal">
                      {trip.tickets.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {trip.tickets.map((ticket) => (
                            <Link
                              key={ticket._id}
                              to={`/tickets/${ticket.num}`}
                              className="text-accent-text"
                            >
                              №{ticket.num}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        "—"
                      )}
                      {trip.ticketIds.length > 1 && (
                        <div className="text-xs text-muted-foreground">
                          Общий расход выезда
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-middle text-right whitespace-nowrap tabular-nums">
                      {trip.totalMinor == null
                        ? trip.estimateMinor == null
                          ? "Ожидается"
                          : `≈ ${money(trip.estimateMinor)}`
                        : money(trip.totalMinor)}
                    </TableCell>
                    <TableCell className="align-middle text-center pe-4">
                      <TripActions
                        trip={trip}
                        onAllocate={() => setQueue([trip])}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Итого по выбранным условиям</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(data.totalMinor)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </div>
      {!error && data.total > 100 && (
        <Pager
          page={page}
          pageSize={100}
          total={data.total}
          loaded={view.trips.length}
          onPage={(value) => change("page", String(value))}
          onLoadMore={() => change("page", String(view.page + 1))}
        />
      )}
      {queue[0] && (
        <AllocationDialog
          key={queue[0]._id}
          trip={queue[0]}
          companies={data.companies}
          remaining={queue.length}
          onSaved={saved}
          onClose={close}
        />
      )}
      <FilterSheet>
        <FilterContainer resetFilterHandler={reset}>
          <Field label="Период" htmlFor="taxi-period">
            <DateRangeField
              id="taxi-period"
              value={period}
              clearable={false}
              onChange={(range) => {
                if (range.from && range.to)
                  setQuery(changeReportQuery(query, range));
              }}
            />
          </Field>
          <Field label="Компания" htmlFor="taxi-company">
            <Combobox
              id="taxi-company"
              value={query.get("companyId")}
              clearable
              onChange={(value) =>
                setQuery(
                  changeReportQuery(query, {
                    companyId: value || "",
                    unassigned: "",
                  }),
                )
              }
              placeholder="Все компании"
              options={data.companies.map((company) => ({
                value: company._id,
                label: company.alias,
              }))}
            />
          </Field>
          {can({ taxi: ["read"] }) && (
            <Field label="Сотрудник" htmlFor="taxi-user">
              <Combobox
                id="taxi-user"
                value={query.get("userId")}
                clearable
                onChange={(value) =>
                  setQuery(
                    changeReportQuery(query, {
                      userId: value || "",
                      scope: "all",
                    }),
                  )
                }
                placeholder="Все сотрудники"
                options={data.users.map((person) => ({
                  value: person._id,
                  label: `${person.lastName} ${person.firstName}`.trim(),
                }))}
              />
            </Field>
          )}
          <SwitchField
            id="taxi-unassigned"
            checked={query.get("unassigned") === "1"}
            onCheckedChange={(checked) =>
              setQuery(
                changeReportQuery(query, {
                  unassigned: checked ? "1" : "",
                  companyId: "",
                }),
              )
            }
            label="Только без компании"
          />
          <SwitchField
            id="taxi-without-ticket"
            checked={query.get("withoutTicket") === "1"}
            onCheckedChange={(checked) =>
              change("withoutTicket", checked ? "1" : "")
            }
            label="Только без заявки"
          />
        </FilterContainer>
      </FilterSheet>
    </PageShell>
  );
}

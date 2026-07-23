import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import {
  RiAddLine,
  RiContractLine,
  RiLinkUnlinkM,
  RiMoreLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eyebrow, Panel } from "@/components/app/Panel";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";
import { InsideOverlayContext } from "@/components/app/overlay-context";
import useOffcanvasStore from "@/store/offcanvas";

import Select from "../../../UI/Select";
import { formatPrice } from "../../../util/format-string";
import { tariffTypeName } from "../../ServicePlan/tariff-types";

// Услуги компании: строки вместо таблицы — название (ссылка на карточку
// услуги), тип и дата в мете, цена справа; «согласование с клиентом» —
// warning-пометка. «Добавить услугу» — привязка существующей (диалог: услуга +
// дата + согласование), открепление — в «⋯» строки с подтверждением.
const money = (value) => formatPrice(Math.round(Number(value) || 0));

const fmtDate = (value) =>
  value ? new Date(value).toLocaleDateString("ru-RU") : null;

// Тарификация: актуальная схема — плоские поля (type/hourPackages/fixedPrice/
// pricePerHour — так пишет мастер и читает карточка услуги); у старых
// документов данные могут лежать во вложенном легаси-объекте tariffing —
// нормализуем к одному виду.
const tariffOf = (plan) => {
  if (plan.type) {
    return {
      type: plan.type,
      hourPackages: plan.hourPackages || [],
      fixedPrice: plan.fixedPrice,
      pricePerHour: plan.pricePerHour,
    };
  }
  const legacy = plan.tariffing;
  if (!legacy?.type) return null;
  return {
    type: legacy.type,
    hourPackages: legacy.hourPackage?.packages || [],
    fixedPrice: legacy.fixedPrice?.price,
    pricePerHour: legacy.hourly?.pricePerHour,
  };
};

const planPrice = (tariff) => {
  if (!tariff) return { value: "—" };
  if (tariff.type === "fixedPrice") return { value: money(tariff.fixedPrice) };
  if (tariff.type === "hourly")
    return { value: money(tariff.pricePerHour), per: "/ч" };
  if (tariff.type === "hourPackage") {
    const prices = tariff.hourPackages
      .map((pack) => Number(pack.pricePerHour) || 0)
      .filter((rate) => rate > 0);
    if (!prices.length) return { value: "—" };
    return { value: `от ${money(Math.min(...prices))}`, per: "/ч" };
  }
  return { value: "—" };
};

const ServicePlansSection = ({ company, plans, servicePlansList, canManage, id }) => {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [addOpen, setAddOpen] = useState(false);
  const [detachPlan, setDetachPlan] = useState(null);
  const [newPlan, setNewPlan] = useState(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const dateRef = useRef(null);

  const busy = fetcher.state !== "idle";

  // Каталог для привязки — без уже подключённых
  const attachOptions = useMemo(() => {
    const attached = new Set(
      (company.servicePlans || []).map((plan) => String(plan._id)),
    );
    return (servicePlansList || []).filter(
      (plan) => !attached.has(String(plan._id)),
    );
  }, [company.servicePlans, servicePlansList]);

  const openAdd = () => {
    setNewPlan(null);
    setApprovalRequired(false);
    setAddOpen(true);
  };

  const submitAdd = (event) => {
    event.preventDefault();
    fetcher.submit(
      {
        intent: "addServicePlan",
        id: company._id,
        servicePlan: newPlan?._id || "",
        isActiveSince: dateRef.current?.value || "",
        customerApprovalRequired: approvalRequired,
      },
      { method: "POST", action: `/companies/${company._id}` },
    );
  };

  // Ветка «создать новую»: диалог закрывается, параметры подключения уезжают
  // query-строкой в мастер услуги (вложенный маршрут карточки, wide-шторка)
  const openWizard = () => {
    const isActiveSince =
      dateRef.current?.value || new Date().toISOString().slice(0, 10);
    setAddOpen(false);
    offcanvas.setShow();
    navigate(
      `service-plans/add?isActiveSince=${isActiveSince}&customerApproval=${approvalRequired}`,
    );
  };

  const confirmDetach = () => {
    fetcher.submit(
      {
        intent: "deleteServicePlan",
        companyId: company._id,
        servicePlanId: detachPlan._id,
      },
      { method: "DELETE", action: `/companies/${company._id}` },
    );
    setDetachPlan(null);
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setAddOpen(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <Eyebrow
        id={id}
        count={plans.length}
        action={
          canManage && (
            <Button size="sm" variant="outline" onClick={openAdd}>
              <RiAddLine /> Добавить услугу
            </Button>
          )
        }
      >
        Услуги
      </Eyebrow>
      <Panel>
        {plans.length === 0 ? (
          <div className="tw:mx-auto tw:flex tw:max-w-md tw:flex-col tw:items-center tw:gap-2 tw:py-6 tw:text-center">
            <RiContractLine size={36} aria-hidden className="tw:text-faint" />
            <div className="tw:font-semibold">Услуги не подключены</div>
            <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">
              Подключите компании услугу из каталога — от неё считаются
              тарификация и отчёты.
            </p>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="tw:mt-1"
                onClick={openAdd}
              >
                <RiAddLine /> Добавить услугу
              </Button>
            )}
          </div>
        ) : (
          plans.map((plan) => {
            const tariff = tariffOf(plan);
            const price = planPrice(tariff);
            return (
              <div
                key={plan._id}
                className="tw:group tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1 tw:border-t tw:border-border-soft tw:py-3 tw:first:border-t-0 tw:first:pt-0 tw:last:pb-0"
              >
                <div className="tw:min-w-0 tw:flex-1">
                  <div className="tw:text-[15px] tw:leading-snug tw:font-medium">
                    <Link
                      to={`/finances/service-plans/${plan._id}`}
                      className="tw:text-accent-text tw:no-underline tw:hover:underline"
                    >
                      {plan.title}
                    </Link>
                  </div>
                  <div className="tw:mt-0.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-0.5 tw:text-[13px] tw:text-muted-foreground">
                    <span>{tariffTypeName(tariff?.type) || "—"}</span>
                    {plan.isActiveSince && (
                      <span className="tw:tabular-nums">
                        <span className="tw:text-faint">·</span> с{" "}
                        {fmtDate(plan.isActiveSince)}
                      </span>
                    )}
                    {plan.customerApprovalRequired && (
                      <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:font-medium tw:text-warning">
                        <span className="tw:size-1.5 tw:rounded-full tw:bg-warning" />
                        согласование с клиентом
                      </span>
                    )}
                  </div>
                </div>
                <div className="tw:flex tw:flex-none tw:items-center tw:gap-1">
                  <span className="tw:text-[15px] tw:font-bold tw:tabular-nums">
                    {price.value}
                    {price.per && (
                      <span className="tw:font-semibold tw:text-muted-foreground">
                        {price.per}
                      </span>
                    )}
                  </span>
                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Действия"
                          title="Действия"
                          className="tw:text-faint tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:max-md:opacity-100 tw:data-[state=open]:opacity-100"
                        >
                          <RiMoreLine />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDetachPlan(plan)}
                        >
                          <RiLinkUnlinkM /> Открепить
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="tw:max-w-lg" aria-describedby={undefined}>
          <InsideOverlayContext.Provider value={true}>
            <DialogHeader>
              <DialogTitle>Добавить услугу</DialogTitle>
            </DialogHeader>

            {fetcher.data?.error && (
              <AlertMessage
                variant="danger"
                message={
                  <>
                    <div>{fetcher.data.error}</div>
                    {fetcher.data.duplicates?.length > 0 && (
                      <ul className="tw:my-1 tw:ps-5">
                        {fetcher.data.duplicates.map((duplicate) => (
                          <li key={duplicate._id}>{duplicate.title}</li>
                        ))}
                      </ul>
                    )}
                  </>
                }
              />
            )}

            <form onSubmit={submitAdd}>
              <Field label="Услуга" required>
                <Select
                  placeholder="Выберите услугу"
                  isClearable
                  isSearchable
                  options={attachOptions}
                  value={newPlan}
                  onChange={(next) => setNewPlan(next || null)}
                  getOptionLabel={(option) => option.title}
                  getOptionValue={(option) => option._id}
                />
              </Field>
              <Field label="Действует с" required>
                <Input
                  type="date"
                  required
                  ref={dateRef}
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </Field>
              <label className="tw:mb-4 tw:flex tw:cursor-pointer tw:items-center tw:gap-2.5 tw:text-sm tw:font-medium">
                <Switch
                  checked={approvalRequired}
                  onCheckedChange={setApprovalRequired}
                />
                Требуется согласование с клиентом
              </label>

              {/* Ветка создания: нужной услуги нет в каталоге */}
              <div className="tw:mb-3.5 tw:flex tw:items-center tw:gap-3 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                <span className="tw:h-px tw:flex-1 tw:bg-border-soft" />
                или
                <span className="tw:h-px tw:flex-1 tw:bg-border-soft" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="tw:w-full"
                onClick={openWizard}
              >
                <RiAddLine /> Новая услуга
              </Button>
              <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
                Откроется мастер услуги; после сохранения она будет подключена
                «{company.alias}» с указанными выше датой и согласованием.
              </p>

              <DialogFooter className="tw:mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAddOpen(false)}
                >
                  Отмена
                </Button>
                <Button type="submit" disabled={busy || !newPlan}>
                  {busy ? "Сохранение…" : "Сохранить"}
                </Button>
              </DialogFooter>
            </form>
          </InsideOverlayContext.Provider>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(detachPlan)}
        onOpenChange={(open) => {
          if (!open) setDetachPlan(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{detachPlan?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              Услуга будет откреплена от компании. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="tw:mt-4">
            <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmDetach}>
              <RiLinkUnlinkM /> Открепить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ServicePlansSection;

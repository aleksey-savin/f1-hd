import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import {
  RiAddLine,
  RiContractLine,
  RiEdit2Line,
  RiLinkUnlinkM,
  RiMoreLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
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
import AttachFields, { emptyAttach } from "../../ServicePlan/AttachFields";
import useOffcanvasStore from "@/store/offcanvas";

import Combobox, { toOptions } from "@/components/app/Combobox";
import {
  formatCalendarDate,
  toDateInputValue,
} from "../../../util/format-date";
import { formatPrice } from "../../../util/format-string";
import { tariffTypeName } from "../../ServicePlan/tariff-types";

// Услуги компании: строки вместо таблицы — название (ссылка на карточку
// услуги), тип и дата в мете, цена справа; «согласование с клиентом» —
// warning-пометка. «Добавить услугу» — привязка существующей (диалог: услуга +
// дата + согласование), открепление — в «⋯» строки с подтверждением.
const money = (value) => formatPrice(Math.round(Number(value) || 0));

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

const ServicePlansSection = ({
  company,
  plans,
  servicePlansList,
  canManage,
  id,
}) => {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [addOpen, setAddOpen] = useState(false);
  const [detachPlan, setDetachPlan] = useState(null);
  const [newPlan, setNewPlan] = useState(null);
  const [attach, setAttach] = useState(emptyAttach);
  // Правка условий уже подключённой услуги — тем же блоком полей, что и
  // добавление: одна форма условий, а не две расходящиеся
  const [editPlan, setEditPlan] = useState(null);

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
    setAttach(emptyAttach());
    setAddOpen(true);
  };

  const openEdit = (plan) => {
    setEditPlan(plan);
    setAttach({
      // isActiveSince — календарная дата (UTC-полночь): день читаем обратно
      // UTC-срезом ISO, а вот «сегодня» — уже локальный день (toDateInputValue),
      // иначе восточнее UTC до смены суток подставлялось бы вчера.
      isActiveSince: plan.isActiveSince
        ? String(plan.isActiveSince).slice(0, 10)
        : toDateInputValue(),
      customerApprovalRequired: Boolean(plan.customerApprovalRequired),
      approver: plan.approver || null,
      subdivisionApprovalRequired: Boolean(plan.subdivisionApprovalRequired),
    });
  };

  const submitEdit = (event) => {
    event.preventDefault();
    fetcher.submit(
      {
        intent: "updateServicePlan",
        id: company._id,
        servicePlanId: editPlan._id,
        isActiveSince: attach.isActiveSince,
        customerApprovalRequired: attach.customerApprovalRequired,
        subdivisionApprovalRequired: attach.subdivisionApprovalRequired,
        approverId: attach.approver?._id || "",
      },
      { method: "POST", action: `/companies/${company._id}` },
    );
  };

  const submitAdd = (event) => {
    event.preventDefault();
    fetcher.submit(
      {
        intent: "addServicePlan",
        id: company._id,
        servicePlan: newPlan?._id || "",
        isActiveSince: attach.isActiveSince,
        customerApprovalRequired: attach.customerApprovalRequired,
        subdivisionApprovalRequired: attach.subdivisionApprovalRequired,
        approverId: attach.approver?._id || "",
      },
      { method: "POST", action: `/companies/${company._id}` },
    );
  };

  // Ветка «создать новую»: диалог закрывается, параметры подключения уезжают
  // query-строкой в мастер услуги (вложенный маршрут карточки, wide-шторка)
  const openWizard = () => {
    setAddOpen(false);
    offcanvas.setShow();
    // Условия подключения уезжают в мастер query-строкой — там их подхватит
    // тот же AttachFields
    const params = new URLSearchParams({
      isActiveSince: attach.isActiveSince,
      customerApproval: String(attach.customerApprovalRequired),
      subdivisionApproval: String(attach.subdivisionApprovalRequired),
      ...(attach.approver?._id ? { approver: attach.approver._id } : {}),
    });
    navigate(`service-plans/add?${params}`);
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
      setEditPlan(null);
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
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-6 text-center">
            <RiContractLine size={36} aria-hidden className="text-faint" />
            <div className="font-semibold">Услуги не подключены</div>
            <p className="my-0 text-sm text-muted-foreground">
              Подключите компании услугу из каталога — от неё считаются
              тарификация и отчёты.
            </p>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
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
                className="group flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-soft py-3 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-snug font-medium">
                    <Link
                      to={`/finances/service-plans/${plan._id}`}
                      className="text-accent-text no-underline hover:underline"
                    >
                      {plan.title}
                    </Link>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm text-muted-foreground">
                    <span>{tariffTypeName(tariff?.type) || "—"}</span>
                    {plan.isActiveSince && (
                      <span className="tabular-nums">
                        <span className="text-faint">·</span> с{" "}
                        {formatCalendarDate(plan.isActiveSince)}
                      </span>
                    )}
                    {plan.customerApprovalRequired && (
                      <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                        <span className="size-1.5 rounded-full bg-warning" />
                        {/* Кто подписывает — часть условия, а не деталь:
                            без согласующего отчёт будет некому согласовать */}
                        согласование
                        {plan.approver
                          ? `: ${plan.approver.lastName || ""} ${plan.approver.firstName || ""}`.trimEnd()
                          : ": не назначен"}
                        {plan.subdivisionApprovalRequired && ", по филиалам"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-1">
                  <span className="text-sm font-bold tabular-nums">
                    {price.value}
                    {price.per && (
                      <span className="font-semibold text-muted-foreground">
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
                          className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100 data-[state=open]:opacity-100"
                        >
                          <RiMoreLine />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(plan)}>
                          <RiEdit2Line /> Изменить условия
                        </DropdownMenuItem>
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

      {/* Правка условий: та же форма, что у добавления, но услуга уже выбрана
          и не меняется — меняется только то, что живёт на привязке */}
      <Dialog
        open={Boolean(editPlan)}
        onOpenChange={(open) => !open && setEditPlan(null)}
      >
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Условия подключения</DialogTitle>
          </DialogHeader>

          {fetcher.data?.error && (
            <AlertMessage variant="danger" message={fetcher.data.error} />
          )}

          <form onSubmit={submitEdit}>
            <div className="mb-4 rounded-lg border border-border bg-accent px-3.5 py-2.5">
              <div className="font-semibold">{editPlan?.title}</div>
              <div className="text-sm text-muted-foreground">
                {tariffTypeName(tariffOf(editPlan || {})?.type) || "—"}
              </div>
            </div>

            <AttachFields
              idPrefix="edit-attach"
              companyId={company._id}
              value={attach}
              onChange={setAttach}
            />

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditPlan(null)}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || (attach.customerApprovalRequired && !attach.approver)
                }
              >
                {busy ? "Сохранение…" : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
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
                    <ul className="my-1 ps-5">
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
              <Combobox
                ariaLabel="Услуга"
                placeholder="Выберите услугу"
                options={toOptions(attachOptions, {
                  value: (option) => String(option._id),
                  label: (option) => option.title,
                })}
                value={newPlan?._id ? String(newPlan._id) : null}
                onChange={(id) =>
                  setNewPlan(
                    attachOptions.find((option) => String(option._id) === id) ||
                      null,
                  )
                }
                clearable
                clearLabel="Не выбрана"
              />
            </Field>
            <AttachFields
              companyId={company._id}
              value={attach}
              onChange={setAttach}
            />

            {/* Ветка создания: нужной услуги нет в каталоге */}
            <div className="mb-3.5 flex items-center gap-3 text-xs font-bold tracking-wider text-faint uppercase">
              <span className="h-px flex-1 bg-border-soft" />
              или
              <span className="h-px flex-1 bg-border-soft" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={openWizard}
            >
              <RiAddLine /> Новая услуга
            </Button>
            <p className="mt-2 mb-0 text-sm text-muted-foreground">
              Откроется мастер услуги; после сохранения она будет подключена «
              {company.alias}» с указанными выше датой и согласованием.
            </p>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddOpen(false)}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !newPlan ||
                  (attach.customerApprovalRequired && !attach.approver)
                }
              >
                {busy ? "Сохранение…" : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
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
          <AlertDialogFooter className="mt-4">
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

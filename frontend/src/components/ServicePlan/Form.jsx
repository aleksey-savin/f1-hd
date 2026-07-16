import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiTimeLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import WizardStepper from "@/components/app/WizardStepper";
import AlertMessage from "@/components/app/AlertMessage";

import Select from "../../UI/Select";
import useOffcanvasStore from "../../store/offcanvas";

import Tariffing from "./Tariffing";
import ScheduleEditor, { SCHEDULE_DAYS, emptyDay } from "./ScheduleEditor";
import Summary from "./Summary";

const STEPS = [
  { label: "Основное" },
  { label: "Тарификация" },
  { label: "График" },
];
const LAST = STEPS.length - 1;

// customProvisionSchedule → полный объект по дням (недостающие дни — дефолт)
const initSchedule = (existing) =>
  Object.fromEntries(
    SCHEDULE_DAYS.map(([, key]) => [
      key,
      existing?.[key]
        ? {
            isWorking: Boolean(existing[key].isWorking),
            is24hours: Boolean(existing[key].is24hours),
            start: existing[key].start || "09:00",
            end: existing[key].end || "18:00",
          }
        : emptyDay(),
    ]),
  );

const ServicePlanForm = ({ title }) => {
  const { servicePlan = {}, ticketCategories = [] } = useLoaderData();
  const isEdit = !!servicePlan._id;

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [form, setForm] = useState({
    title: servicePlan.title || "",
    ticketCategories: servicePlan.ticketCategories || [],
    type: servicePlan.type || "fixedPrice",
    fixedPrice: servicePlan.fixedPrice ? Math.round(servicePlan.fixedPrice) : 0,
    pricePerHour: servicePlan.pricePerHour
      ? Math.round(servicePlan.pricePerHour)
      : 0,
    pricePerHourNonWorking: servicePlan.pricePerHourNonWorking || 0,
    packagesNonWorkingCalcMethod:
      servicePlan.packagesNonWorkingCalcMethod || "separatePayment",
    packagesNonWorkingCoefficient:
      servicePlan.packagesNonWorkingCoefficient || 1,
    tariffingPeriod: servicePlan.tariffingPeriod || 60,
    companyWorkSchedule: servicePlan.companyWorkSchedule || false,
  });

  const [hourPackages, setHourPackages] = useState(
    servicePlan.hourPackages?.length
      ? servicePlan.hourPackages.map((pkg) => ({
          hours: pkg.hours,
          pricePerHour: Math.round(pkg.pricePerHour || 0),
        }))
      : [{ hours: 12, pricePerHour: 1000 }],
  );

  const [schedule, setSchedule] = useState(
    initSchedule(servicePlan.customProvisionSchedule),
  );

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(isEdit ? LAST : 0);
  const [attempted, setAttempted] = useState(false);

  const setField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  // Обязательные поля есть только на первом шаге
  const stepValid = (index) =>
    index !== 0 ||
    (form.title.trim() !== "" && form.ticketCategories.length > 0);

  const stepError = (index) =>
    index === 0 && !stepValid(0)
      ? "Заполните наименование и выберите хотя бы одну категорию"
      : null;

  const handleNext = () => {
    if (!stepValid(step)) {
      setAttempted(true);
      return;
    }
    const next = Math.min(step + 1, LAST);
    setAttempted(false);
    setStep(next);
    setMaxReached((prev) => Math.max(prev, next));
  };

  const handleBack = () => {
    setAttempted(false);
    setStep((current) => Math.max(0, current - 1));
  };

  const handleStepClick = (index) => {
    if (isEdit || index <= maxReached) {
      setAttempted(false);
      setStep(index);
    }
  };

  const handleClose = () => {
    offcanvas.setClose();
    navigate(-1);
  };

  const saving = fetcher.state !== "idle";

  const handleSubmit = () => {
    if (!stepValid(0)) {
      setStep(0);
      setAttempted(true);
      return;
    }

    const payload = {
      title: form.title.trim(),
      ticketCategories: form.ticketCategories.map((category) => category._id),
      companyWorkSchedule: Boolean(form.companyWorkSchedule),
      customProvisionSchedule: schedule,
      type: form.type,
      hourPackages:
        form.type === "hourPackage"
          ? hourPackages.map((pkg) => {
              const hours = Number(pkg.hours) || 0;
              const pricePerHour = Number(pkg.pricePerHour) || 0;
              return {
                hours,
                pricePerHour,
                totalPrice: Math.round(hours * pricePerHour),
              };
            })
          : [],
      fixedPrice: Number(form.fixedPrice) || 0,
      pricePerHour: Number(form.pricePerHour) || 0,
      pricePerHourNonWorking: Number(form.pricePerHourNonWorking) || 0,
      packagesNonWorkingCalcMethod:
        form.type === "hourPackage"
          ? form.packagesNonWorkingCalcMethod
          : "separatePayment",
      packagesNonWorkingCoefficient:
        Number(form.packagesNonWorkingCoefficient) || 1,
      tariffingPeriod: Number(form.tariffingPeriod) || 0,
    };

    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };

  // Успешный сабмит — закрываем шторку и уходим на «..» (список или карточка)
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      offcanvas.setClose();
      navigate("..");
    }
  }, [fetcher.state, fetcher.data]);

  const renderStep = () => {
    if (step === 0) {
      return (
        <div>
          <div className="tw:mb-4">
            <h3 className="tw:my-0 tw:text-base tw:font-semibold tw:tracking-tight">
              Основное
            </h3>
            <p className="tw:mt-0.5 tw:mb-0 tw:text-sm tw:text-muted-foreground">
              Название услуги и к каким категориям заявок она относится
            </p>
          </div>
          <Field label="Наименование" htmlFor="title" required>
            <Input
              id="title"
              autoFocus
              value={form.title}
              onChange={(event) => setField("title", event.target.value)}
            />
          </Field>
          <Field label="Категории заявок" htmlFor="ticketCategories" required>
            <Select
              id="ticketCategories"
              placeholder="Выберите категории заявок"
              closeMenuOnSelect={false}
              isClearable
              isSearchable
              isMulti
              value={form.ticketCategories}
              options={ticketCategories}
              getOptionLabel={(option) => option.title}
              getOptionValue={(option) => option._id}
              onChange={(selected) =>
                setField("ticketCategories", selected || [])
              }
            />
          </Field>
        </div>
      );
    }

    if (step === 1) {
      return (
        <Tariffing
          form={form}
          setField={setField}
          packages={hourPackages}
          setPackages={setHourPackages}
        />
      );
    }

    return (
      <div>
        <div className="tw:mb-4">
          <h3 className="tw:my-0 tw:text-base tw:font-semibold tw:tracking-tight">
            График оказания
          </h3>
          <p className="tw:mt-0.5 tw:mb-0 tw:text-sm tw:text-muted-foreground">
            Когда услуга доступна
          </p>
        </div>
        <SwitchField
          id="companyWorkSchedule"
          checked={form.companyWorkSchedule}
          onCheckedChange={(checked) =>
            setField("companyWorkSchedule", checked)
          }
          label="По графику работы компании"
          hint="Услуга оказывается в те же часы, что и работает компания"
        />
        {form.companyWorkSchedule ? (
          <div className="tw:mt-2 tw:flex tw:items-center tw:gap-2 tw:rounded-xl tw:border tw:border-border-soft tw:bg-accent/40 tw:px-4 tw:py-3 tw:text-sm tw:text-muted-foreground">
            <RiTimeLine className="tw:flex-none tw:text-faint" />
            Часы оказания берутся из графика работы компании — отдельное
            расписание не задаётся.
          </div>
        ) : (
          <div className="tw:mt-1">
            <ScheduleEditor schedule={schedule} onChange={setSchedule} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <h1 className="tw:my-0 tw:mb-4 tw:pr-10 tw:text-2xl tw:font-semibold tw:tracking-tight">
        {title}
      </h1>

      <WizardStepper
        steps={STEPS}
        current={step}
        maxReached={maxReached}
        allowJump={isEdit}
        onStepClick={handleStepClick}
      />

      <div className="tw:mt-6 tw:flex tw:flex-col tw:gap-6 tw:md:flex-row">
        <div className="tw:min-w-0 tw:flex-1">
          {renderStep()}
          {attempted && stepError(step) && (
            <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-destructive">
              {stepError(step)}
            </p>
          )}
        </div>
        <div className="tw:md:w-72 tw:md:flex-none">
          <Summary
            form={{ ...form, schedule }}
            packages={hourPackages}
            reached={maxReached}
          />
        </div>
      </div>

      {fetcher.data && fetcher.data.error && (
        <div className="tw:mt-4">
          <AlertMessage variant="danger" message={fetcher.data.message} />
        </div>
      )}

      <div className="tw:sticky tw:bottom-0 tw:-mx-6 tw:mt-6 tw:flex tw:items-center tw:gap-2.5 tw:border-t tw:border-border-soft tw:bg-background tw:px-6 tw:py-3">
        <Button
          type="button"
          variant="ghost"
          onClick={handleClose}
          disabled={saving}
        >
          Отмена
        </Button>
        <div className="tw:ml-auto tw:flex tw:items-center tw:gap-2.5">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={saving}
            >
              <RiArrowLeftLine /> Назад
            </Button>
          )}
          {step < LAST && (
            <Button type="button" onClick={handleNext}>
              Далее <RiArrowRightLine />
            </Button>
          )}
          {step === LAST && (
            <Button type="button" onClick={handleSubmit} disabled={saving}>
              <RiCheckLine /> Сохранить
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServicePlanForm;

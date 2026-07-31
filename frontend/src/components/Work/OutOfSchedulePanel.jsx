import {
  RiAlertLine,
  RiCheckLine,
  RiCheckboxCircleLine,
  RiRefreshLine,
  RiTimeLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { formatMoney } from "../Report/work-format";
import { formatDurationWords } from "./duration";

/**
 * «Вне графика обслуживания» — блок формы работы: сколько времени вышло за
 * график клиента, ПОЧЕМУ и во сколько это обойдётся.
 *
 * Ничего не считает: цифры приходят с `POST /api/works/preview`, который зовёт
 * тот же код, что выставляет счёт (`backend/services/workPreview`). Раньше
 * расчёт жил в браузере и читал график в поясе оператора, тогда как счёт —
 * в поясе клиента.
 *
 * Права тоже решает сервер: без права видеть суммы ключа `money` в ответе нет
 * вовсе, и строки «К тарификации» / «Доп. оплата» не рисуются. Факт
 * переработки и переключатель остаются: «была ли работа в рабочее время» —
 * решение инженера, а не бухгалтера.
 *
 * @param {Object|null} preview ответ ручки предпросмотра
 * @param {boolean} isLoading идёт запрос (прежнее значение приглушаем)
 * @param {boolean} isError расчёт не получен
 * @param {Function} onRetry повтор запроса
 * @param {boolean} withinPlan значение переключателя
 * @param {Function} onWithinPlanChange
 */
const OutOfSchedulePanel = ({
  preview,
  isLoading = false,
  isError = false,
  onRetry,
  withinPlan,
  onWithinPlanChange,
}) => {
  if (isError) {
    return (
      <Shell tone="danger">
        <Head
          icon={<RiAlertLine />}
          tone="danger"
          title="Не удалось рассчитать доплату"
          why="Работу можно сохранить — сумму посчитает отчёт по услуге"
          action={
            onRetry && (
              <Button type="button" variant="outline" size="xs" onClick={onRetry}>
                <RiRefreshLine /> Повторить
              </Button>
            )
          }
        />
      </Shell>
    );
  }

  // Пока считаем впервые — тонкий скелет; при пересчёте показанное значение
  // приглушается ниже (тот же контракт, что у отчётов)
  if (isLoading && !preview) {
    return (
      <Shell>
        <div className="tw:flex tw:items-center tw:gap-3">
          <Tile tone="neutral">
            <RiTimeLine />
          </Tile>
          <div className="tw:flex tw:flex-1 tw:flex-col tw:gap-2">
            <span className="tw:block tw:h-2.5 tw:w-3/5 tw:rounded-full tw:bg-secondary" />
            <span className="tw:block tw:h-2.5 tw:w-2/5 tw:rounded-full tw:bg-secondary" />
          </div>
        </div>
      </Shell>
    );
  }

  if (!preview?.hasServicePlan) {
    return null;
  }

  const dim = isLoading ? "tw:opacity-60" : undefined;

  // Категория со снятой тарификацией: доплаты не бывает, и рычага тоже — его
  // всё равно перебьёт сервер
  if (preview.alwaysWithinPlan) {
    return (
      <Shell className={dim}>
        <Head
          icon={<RiCheckLine />}
          tone="ok"
          title={
            preview.alwaysWithinPlanCategory
              ? `Категория «${preview.alwaysWithinPlanCategory}» всегда входит в график обслуживания`
              : "Заявка всегда входит в график обслуживания"
          }
          why="Доплаты за нерабочее время по такой заявке не бывает"
        />
      </Shell>
    );
  }

  if (!preview.overtime) {
    return null;
  }

  const { actualMinutes, roundedMinutes, reason } = preview.overtime;
  const money = preview.overtime.money;

  // У почасового тарифа доп. оплаты не существует — сервер её и не присылает.
  // Факт переработки остаётся: он не про деньги, а рычага здесь нет — он
  // ничего не изменит
  if (preview.tariffType === "hourly") {
    return (
      <Shell className={dim}>
        <Head
          icon={<RiTimeLine />}
          tone="neutral"
          title={`Работа вне графика обслуживания — ${formatDurationWords(actualMinutes)}`}
          why="Тариф почасовой: доплаты за нерабочее время не бывает, время оплачивается по общей ставке"
        />
      </Shell>
    );
  }

  // Переключатель включён — числа схлопываются: «Доп. оплата 0 ₽» заставляет
  // искать подвох там, где его нет. Сумму, от которой отказались, называем в
  // подсказке, иначе выключить его обратно нечем, кроме памяти
  if (withinPlan) {
    const declined = preview.overtime.money?.cost ?? null;

    return (
      <Shell className={dim}>
        <Head
          icon={<RiCheckboxCircleLine />}
          tone="ok"
          title="Учтено в рамках плана — доплаты не будет"
          why={`Работа вне графика на ${formatDurationWords(preview.overtime.actualMinutes)}, но учтена как выполненная в рабочее время`}
        />
        <SwitchRow
          checked
          onChange={onWithinPlanChange}
          hint={
            declined == null
              ? "Выключите, чтобы вернуть тарификацию нерабочего времени"
              : `Выключите, чтобы вернуть доплату ${formatMoney(declined)}`
          }
        />
      </Shell>
    );
  }

  return (
    <Shell tone="warning" className={dim}>
      <Head
        icon={<RiAlertLine />}
        tone="warning"
        title={
          <>
            Работа{" "}
            <span className="tw:text-warning">вне графика обслуживания</span> —{" "}
            {formatDurationWords(actualMinutes)}
          </>
        }
        why={reason?.text}
      />

      <dl className="tw:m-0 tw:grid tw:grid-cols-[9rem_auto_1fr] tw:items-baseline tw:gap-x-4 tw:gap-y-2.5 tw:text-base">
        <dt className="tw:text-muted-foreground">Вне графика</dt>
        <dd className="tw:m-0 tw:font-semibold tw:tabular-nums">
          {formatDurationWords(actualMinutes)}
        </dd>
        <dd className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          {preview.schedule ? `график: ${preview.schedule}` : ""}
        </dd>

        {money && (
          <>
            <dt className="tw:text-muted-foreground">К тарификации</dt>
            <dd className="tw:m-0 tw:font-semibold tw:tabular-nums">
              {formatDurationWords(roundedMinutes)}
            </dd>
            <dd className="tw:m-0 tw:text-sm tw:text-muted-foreground">
              {money.tariffingPeriod
                ? `округление вверх до ${money.tariffingPeriod} мин`
                : ""}
            </dd>

            {/* Итог отбит линией и набран крупнее: это единственное число
                блока, ради которого его читают */}
            <dt className="tw:mt-1 tw:border-t tw:border-border-soft tw:pt-3 tw:text-muted-foreground">
              Доп. оплата
            </dt>
            <dd className="tw:m-0 tw:mt-1 tw:border-t tw:border-border-soft tw:pt-3 tw:text-2xl tw:leading-none tw:font-bold tw:tabular-nums">
              {formatMoney(money.cost)}
            </dd>
            <dd className="tw:m-0 tw:mt-1 tw:border-t tw:border-border-soft tw:pt-3 tw:text-sm tw:text-muted-foreground">
              {money.pricePerHourNonWorking
                ? `${formatMoney(money.pricePerHourNonWorking)}/ч сверх тарифа`
                : ""}
            </dd>
          </>
        )}
      </dl>

      <SwitchRow
        checked={false}
        onChange={onWithinPlanChange}
        hint={
          money
            ? "Доплаты не будет — работа войдёт в тариф"
            : "Работа войдёт в тариф"
        }
      />
    </Shell>
  );
};

const Shell = ({ tone, className, children }) => (
  <div
    className={cn(
      "tw:flex tw:flex-col tw:gap-3 tw:rounded-xl tw:border tw:border-border tw:bg-background tw:p-4",
      tone === "warning" && "tw:border-warning/40 tw:bg-warning/5",
      tone === "danger" && "tw:border-destructive/40",
      className,
    )}
  >
    {children}
  </div>
);

const Tile = ({ tone, children }) => (
  <span
    className={cn(
      "tw:grid tw:size-8 tw:flex-none tw:place-items-center tw:rounded-lg",
      tone === "warning" && "tw:bg-warning/15 tw:text-warning",
      tone === "ok" && "tw:bg-primary/15 tw:text-accent-text",
      tone === "danger" && "tw:bg-destructive/15 tw:text-destructive",
      tone === "neutral" && "tw:bg-secondary tw:text-faint",
    )}
  >
    {children}
  </span>
);

const Head = ({ icon, tone, title, why, action }) => (
  <div className="tw:flex tw:items-start tw:gap-3">
    <Tile tone={tone}>{icon}</Tile>
    <div className="tw:min-w-0 tw:flex-1">
      <p className="tw:m-0 tw:text-base tw:leading-snug tw:font-semibold">
        {title}
      </p>
      {why && (
        <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          {why}
        </p>
      )}
    </div>
    {action}
  </div>
);

const SwitchRow = ({ checked, onChange, hint }) => (
  <div className="tw:flex tw:items-start tw:gap-3">
    <Switch
      id="withinPlan"
      checked={checked}
      onCheckedChange={onChange}
      className="tw:mt-0.5"
    />
    <div className="tw:min-w-0">
      <label
        htmlFor="withinPlan"
        className="tw:m-0 tw:block tw:text-base tw:font-medium"
      >
        Учесть как работу в рабочее время
      </label>
      <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        {hint}
      </p>
    </div>
  </div>
);

export default OutOfSchedulePanel;

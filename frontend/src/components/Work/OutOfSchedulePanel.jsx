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
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={onRetry}
              >
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
        <div className="flex items-center gap-3">
          <Tile tone="neutral">
            <RiTimeLine />
          </Tile>
          <div className="flex flex-1 flex-col gap-2">
            <span className="block h-2.5 w-3/5 rounded-full bg-secondary" />
            <span className="block h-2.5 w-2/5 rounded-full bg-secondary" />
          </div>
        </div>
      </Shell>
    );
  }

  if (!preview?.hasServicePlan) {
    return null;
  }

  const dim = isLoading ? "opacity-60" : undefined;

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
            <span className="text-warning">вне графика обслуживания</span> —{" "}
            {formatDurationWords(actualMinutes)}
          </>
        }
        why={reason?.text}
      />

      <dl className="m-0 grid grid-cols-[9rem_auto_1fr] items-baseline gap-x-4 gap-y-2.5 text-base">
        <dt className="text-muted-foreground">Вне графика</dt>
        <dd className="m-0 font-semibold tabular-nums">
          {formatDurationWords(actualMinutes)}
        </dd>
        <dd className="m-0 text-sm text-muted-foreground">
          {preview.schedule ? `график: ${preview.schedule}` : ""}
        </dd>

        {money && (
          <>
            <dt className="text-muted-foreground">К тарификации</dt>
            <dd className="m-0 font-semibold tabular-nums">
              {formatDurationWords(roundedMinutes)}
            </dd>
            <dd className="m-0 text-sm text-muted-foreground">
              {money.tariffingPeriod
                ? `округление вверх до ${money.tariffingPeriod} мин`
                : ""}
            </dd>

            {/* Итог отбит линией и набран крупнее: это единственное число
                блока, ради которого его читают */}
            <dt className="mt-1 border-t border-border-soft pt-3 text-muted-foreground">
              Доп. оплата
            </dt>
            <dd className="m-0 mt-1 border-t border-border-soft pt-3 text-2xl leading-none font-bold tabular-nums">
              {formatMoney(money.cost)}
            </dd>
            <dd className="m-0 mt-1 border-t border-border-soft pt-3 text-sm text-muted-foreground">
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
      "flex flex-col gap-3 rounded-xl border border-border bg-background p-4",
      tone === "warning" && "border-warning/40 bg-warning/5",
      tone === "danger" && "border-destructive/40",
      className,
    )}
  >
    {children}
  </div>
);

const Tile = ({ tone, children }) => (
  <span
    className={cn(
      "grid size-8 flex-none place-items-center rounded-lg",
      tone === "warning" && "bg-warning/15 text-warning",
      tone === "ok" && "bg-primary/15 text-accent-text",
      tone === "danger" && "bg-destructive/15 text-destructive",
      tone === "neutral" && "bg-secondary text-faint",
    )}
  >
    {children}
  </span>
);

const Head = ({ icon, tone, title, why, action }) => (
  <div className="flex items-start gap-3">
    <Tile tone={tone}>{icon}</Tile>
    <div className="min-w-0 flex-1">
      <p className="m-0 text-base leading-snug font-semibold">{title}</p>
      {why && <p className="mt-1 mb-0 text-sm text-muted-foreground">{why}</p>}
    </div>
    {action}
  </div>
);

const SwitchRow = ({ checked, onChange, hint }) => (
  <div className="flex items-start gap-3">
    <Switch
      id="withinPlan"
      checked={checked}
      onCheckedChange={onChange}
      className="mt-0.5"
    />
    <div className="min-w-0">
      <label htmlFor="withinPlan" className="m-0 block text-base font-medium">
        Учесть как работу в рабочее время
      </label>
      <p className="mt-1 mb-0 text-sm text-muted-foreground">{hint}</p>
    </div>
  </div>
);

export default OutOfSchedulePanel;

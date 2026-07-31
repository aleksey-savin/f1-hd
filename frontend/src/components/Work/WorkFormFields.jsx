import { RiTimeLine, RiUserLine } from "react-icons/ri";

import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import Combobox, { MultiCombobox } from "@/components/app/Combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  formatCalendarDate,
  shiftLocalForm,
  toDateTimeLocal,
} from "../../util/format-date";

import OutOfSchedulePanel from "./OutOfSchedulePanel";
import { formatDurationWords } from "./duration";

// Чип называет результат («30 мин»), а не операцию («+30 мин»): инженер думает
// «работал полчаса», а не «прибавить тридцать к тому, что стоит».
//
// Отсчёт идёт НАЗАД ОТ ОКОНЧАНИЯ: работу отмечают после того, как её сделали,
// поэтому по умолчанию она только что закончилась. Вперёд от начала считаем
// только тогда, когда начало уже введено, а окончания ещё нет.
//
// Шкала — ЧЕТВЕРТИ ЧАСА, и это не про частоту ввода, а про арифметику:
// 15/30/45/60/90/120 дают целые доли часа (0,25 · 0,5 · 0,75 · 1 · 1,5 · 2), а
// десятки минут делятся на 3 с периодом (10 мин = 0,1(6) ч) — дальше по
// расчёту эти дроби вылезают кривыми цифрами. Пробовали набор по частоте
// (10/20/30/40/…): он точнее попадает в то, что вводят руками, и отвергнут
// ровно из-за этого. Дальше 2 часов чипы не идут: длиннее — 6,1 % работ, и это
// ровный хвост (2:30, 3:00, 4:00, 5:00, 8:00), который вводят руками.
const DURATION_CHIPS = [15, 30, 45, 60, 90, 120];

const TYPE_OPTIONS = [
  { value: "remote", label: "Удалённо" },
  { value: "onSite", label: "Выезд" },
];

/**
 * Поля формы работы — одни на все режимы (`WORK_MODES` в use-work-form).
 * Разметка без формы и футера: сабмит у маршрутных форм карточки и у шторки
 * массового добавления разный, а поля обязаны совпадать.
 *
 * @param {Object} form состояние из useWorkForm
 * @param {Array} performers кандидаты в исполнители
 * @param {Array} otherTickets заявки-кандидаты для «Связанных заявок»
 * @param {boolean} canPickPerformer выбирать исполнителя вправе администратор
 * @param {string|null} limitWorksDateFrom дата, раньше которой период закрыт отчётом
 */
const WorkFormFields = ({
  form,
  performers = [],
  otherTickets = [],
  canPickPerformer = false,
  limitWorksDateFrom = null,
}) => {
  const {
    config,
    isPlan,
    visitRequired,
    setVisitRequired,
    description,
    setDescription,
    startedAt,
    setStartedAt,
    finishedAt,
    setFinishedAt,
    performerId,
    setPerformerId,
    linkedTicketIds,
    setLinkedTicketIds,
    withinPlan,
    setWithinPlan,
    durationMs,
    isReversed,
    isLong,
    preview,
    isPreviewLoading,
    isPreviewError,
    retryPreview,
  } = form;

  const minStart = limitWorksDateFrom ? toDateTimeLocal(limitWorksDateFrom) : "";
  const performerLabel = isPlan ? "Исполнитель" : "Кто выполнил";
  const performer = performers.find(
    (person) => String(person._id) === String(performerId),
  );

  const setDuration = (minutes) => {
    // Окончание уже стоит — двигаем начало назад, окончание не трогаем
    if (finishedAt) {
      setStartedAt(shiftLocalForm(finishedAt, -minutes));
      return;
    }

    // Введено только начало — считаем вперёд от него
    if (startedAt) {
      setFinishedAt(shiftLocalForm(startedAt, minutes));
      return;
    }

    // Пустая форма: работа только что закончилась
    const now = toDateTimeLocal();
    setFinishedAt(now);
    setStartedAt(shiftLocalForm(now, -minutes));
  };

  const activeChip =
    durationMs != null && durationMs > 0 ? durationMs / 60000 : null;

  return (
    <div className="tw:flex tw:flex-col">
      <Field label="Тип работы">
        <Segmented
          ariaLabel="Тип работы"
          options={TYPE_OPTIONS}
          value={visitRequired ? "onSite" : "remote"}
          onChange={(value) => setVisitRequired(value === "onSite")}
          className="tw:w-fit"
        />
      </Field>

      <Field
        label={config.descriptionLabel}
        htmlFor="work-description"
        required={config.descriptionRequired}
        hint={
          isPlan
            ? "Необязательно — можно дописать при подтверждении."
            : "Текст попадёт в отчёт клиенту."
        }
      >
        <Textarea
          id="work-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div className="tw:grid tw:gap-3 tw:md:grid-cols-2">
        <Field
          label={isPlan ? "Планируемое начало" : "Начало"}
          htmlFor="work-started-at"
          required
          hint={
            minStart
              ? `Отчёт по услуге сформирован — работы можно указывать с ${formatCalendarDate(limitWorksDateFrom)}.`
              : undefined
          }
        >
          <div className="tw:flex tw:gap-2">
            <Input
              id="work-started-at"
              type="datetime-local"
              value={startedAt}
              min={minStart || undefined}
              onChange={(event) => setStartedAt(event.target.value)}
              className="tw:min-w-0 tw:flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStartedAt(toDateTimeLocal())}
            >
              Сейчас
            </Button>
          </div>
        </Field>

        <Field
          label={isPlan ? "Планируемое окончание" : "Окончание"}
          htmlFor="work-finished-at"
          required
          hint={
            isReversed ? (
              <span className="tw:text-destructive">
                Окончание раньше начала.
              </span>
            ) : undefined
          }
        >
          <div className="tw:flex tw:gap-2">
            <Input
              id="work-finished-at"
              type="datetime-local"
              value={finishedAt}
              min={startedAt || minStart || undefined}
              onChange={(event) => setFinishedAt(event.target.value)}
              className={cn(
                "tw:min-w-0 tw:flex-1",
                isReversed && "tw:border-destructive",
              )}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFinishedAt(toDateTimeLocal())}
            >
              Сейчас
            </Button>
          </div>
        </Field>
      </div>

      <div className="tw:mb-4">
        <div className="tw:flex tw:items-baseline tw:gap-3">
          <span className="tw:text-sm tw:font-semibold tw:text-muted-foreground">
            Длительность
          </span>
          <span
            className={cn(
              "tw:ml-auto tw:text-lg tw:font-semibold tw:tabular-nums",
              isReversed && "tw:text-destructive",
            )}
          >
            {durationMs == null || isReversed
              ? "—"
              : formatDurationWords(durationMs / 60000)}
          </span>
        </div>

        {/* Чипы — основной способ задать длительность, поэтому размер обычной
            кнопки, а не мелкой: по ним целятся мышью и пальцем чаще, чем
            правят время руками */}
        <div className="tw:mt-2.5 tw:flex tw:flex-wrap tw:gap-2">
          {DURATION_CHIPS.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDuration(minutes)}
              className={cn(
                "tw:rounded-full tw:px-4",
                activeChip === minutes &&
                  "tw:border-primary tw:bg-primary/10 tw:font-semibold tw:text-accent-text",
              )}
            >
              {formatDurationWords(minutes)}
            </Button>
          ))}
        </div>

        {isLong && !isReversed && (
          <p className="tw:mt-2 tw:mb-0 tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-warning">
            <RiTimeLine size={14} /> Дольше 12 часов — проверьте время.
          </p>
        )}
      </div>

      <div className="tw:mb-4">
        <OutOfSchedulePanel
          preview={preview}
          isLoading={isPreviewLoading}
          isError={isPreviewError}
          onRetry={retryPreview}
          withinPlan={withinPlan}
          onWithinPlanChange={setWithinPlan}
        />
      </div>

      {canPickPerformer ? (
        <Field label={performerLabel} htmlFor="work-performer" required>
          <div className="tw:flex tw:gap-2">
            <Combobox
              id="work-performer"
              value={performerId || null}
              options={performers.map((person) => ({
                value: String(person._id),
                label: `${person.lastName} ${person.firstName}`,
                hint: person.position || undefined,
              }))}
              onChange={(value) => setPerformerId(value ?? "")}
              placeholder="Выберите сотрудника"
              className="tw:min-w-0 tw:flex-1"
            />
          </div>
        </Field>
      ) : (
        // Исполнителя всё равно проставит сервер — интерфейс это произносит,
        // а не молчит
        <p className="tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground">
          <RiUserLine size={15} className="tw:text-faint" />
          {performerLabel} ·{" "}
          <span className="tw:font-medium tw:text-foreground">
            {performer ? `${performer.lastName} ${performer.firstName}` : "Вы"}
          </span>
        </p>
      )}

      {config.linkTickets && otherTickets.length > 0 && (
        <Field
          label="Связанные заявки"
          htmlFor="work-linked-tickets"
          hint="Работа будет учтена и в этих заявках."
        >
          <MultiCombobox
            id="work-linked-tickets"
            value={linkedTicketIds}
            options={otherTickets.map((ticket) => ({
              value: String(ticket._id),
              label: `№${ticket.num} · ${ticket.title}`,
            }))}
            onChange={setLinkedTicketIds}
            placeholder="Найти заявку…"
          />
        </Field>
      )}
    </div>
  );
};

export default WorkFormFields;

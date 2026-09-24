import { useContext, useMemo, useState } from "react";
import { Link } from "react-router";

import FilterChip from "@/components/app/FilterChip";
import { Eyebrow, Panel } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import TicketListRow from "../Ticket/Row";
import { AuthedUserContext } from "../../store/authed-user-context";
import useDashboardTicketsStore from "../../store/dashboard-tickets";
import { createdText } from "../Ticket/ticket-state";
import { plural } from "../../util/plural";
import TicketRow from "./TicketRow";
import { useCan } from "@/store/authed-user";

/**
 * Заявки сотрудника — один блок с переключателем срезов: «На мне»,
 * «Без ответственного», «Давно без движения».
 *
 * Тремя карточками подряд это стоило больше тысячи пикселей вертикали, и вместе
 * с ними под сгиб уезжало всё остальное — мониторинг, работы, сроки. Срезы
 * делят один набор (`store/dashboard-tickets`) и один вид строки, поэтому это
 * одна панель с переключателем, а не три панели подряд.
 *
 * **Счётчики — в подписях сегментов**: «19 без ответственного» видно, не
 * открывая срез, ради этого `app/Segmented` и научился числу. Счётчик у метки
 * секции — размер НАБОРА: сколько открытых заявок человеку видно вообще. Это не
 * сумма срезов и не может ею быть — срезы пересекаются (молчащая заявка бывает
 * и моей), 7 + 11 + 5 не значит ничего, а «32 открытых» значит. Когда живой срез
 * остаётся один, метка называет его самого, и счётчик у неё — его же.
 *
 * **Пустой срез не показывается вовсе**, а если остаётся один — переключателя
 * нет и метка секции называет сам срез: переключатель, который не сужает, не
 * показываем (то же правило, что у сегмента «Мои | Компании» у клиента).
 *
 * **«Давно без движения» — набор, а не верхушка сортировки.** Правила (порог в
 * рабочих днях и что не идёт в зачёт) лежат в настройках, считает их бэкенд
 * (`services/ticketActivity`) и присылает каждой заявке `isStale` и
 * `silentDays`. Пока правила не было, у среза не могло быть и счётчика: число
 * означало бы «сколько строк нарисовано».
 *
 * Про сроки блока НЕТ и не будет. `deadline` в этой системе проставляется
 * автоматически как «создание + 5 часов» — он стоит у всех 13 271 заявки, и
 * формально просрочены все открытые до единой. Метрика, у которой всегда
 * максимум, перестаёт быть сигналом; вместо неё — время последнего движения.
 */

const ROWS = 5;

// «12 дней» — сколько РАБОЧИХ дней заявка молчит. Число считает бэкенд
// (services/ticketActivity) по хронике заявки и производственному календарю;
// здесь остаётся только склонение.
const silenceText = (ticket) => {
  const days = ticket.silentDays ?? 0;
  if (days <= 0) return "сегодня";
  if (days === 1) return "1 день";
  if (days < 5) return `${days} дня`;
  return `${days} дней`;
};

const companyMeta = (ticket) =>
  [ticket.company?.alias, ticket.category?.title].filter(Boolean).join(" · ");

const createdTrailing = (ticket) => createdText(ticket.createdAt);

const StaffTickets = () => {
  const { _id: userId } = useContext(AuthedUserContext);
  const can = useCan();
  const tickets = useDashboardTicketsStore((state) => state.tickets);
  const loaded = useDashboardTicketsStore((state) => state.loaded);
  // Порог приезжает с заявками: правила живут в настройках, считает их бэкенд,
  // блоку число нужно только чтобы назвать правило словами.
  const thresholdDays = useDashboardTicketsStore(
    (state) => state.staleRules?.thresholdDays ?? 0,
  );
  const [selected, setSelected] = useState("mine");

  // Ничейные заявки видит только тот, кому бэкенд вообще отдаёт чужие: у
  // остальных набор физически состоит из их собственных, и срез был бы пуст
  // всегда (см. скоуп all-opened в controllers/ticket.js).
  const seesOthers = !!can({
    ticket: { actions: ["readAll", "readCompanies"], connector: "OR" },
  });
  // Меню «⋯» строки — те же права, что на странице заявок
  const canEdit = !!can({ ticket: ["manage"] });
  const canDelete = !!can({ ticket: ["delete"] });

  const mine = useMemo(
    () =>
      tickets.filter((ticket) =>
        (ticket.responsibles ?? []).some(
          (user) => String(user?._id) === String(userId),
        ),
      ),
    [tickets, userId],
  );

  const unassigned = useMemo(
    () =>
      seesOthers ? tickets.filter((t) => !(t.responsibles ?? []).length) : [],
    [tickets, seesOthers],
  );

  // Машинные заявки (мониторинг, антивирус, отчёты бэкапов) держим отдельным
  // счётчиком: их большинство, и без разделения «19 без ответственного»
  // читается как «команда не разгребает», хотя людских там семь.
  const [fromPeople, fromMachines] = useMemo(() => {
    // Поля `isAuto` у заявки нет — признак собирается из источника и заявителя
    // (тот же, что у `isMachineTicket` на бэкенде). Раньше здесь стоял и
    // `ticket.isAuto`, и `source`, но ни того ни другого в ответе не было:
    // деление держалось на одном «нет заявителя» и считало мониторинг людьми.
    const machine = (ticket) =>
      ticket.source === "Мониторинг устройств" || !ticket.applicant;
    return [
      unassigned.filter((ticket) => !machine(ticket)),
      unassigned.filter(machine),
    ];
  }, [unassigned]);

  // Срез считает бэкенд по правилам из настроек («Настройки → Заявки»): здесь
  // только сортировка, чтобы самая молчащая была сверху.
  const stale = useMemo(
    () =>
      tickets
        .filter((ticket) => ticket.isStale)
        .sort((a, b) => (b.silentDays ?? 0) - (a.silentDays ?? 0)),
    [tickets],
  );

  const tabs = useMemo(() => {
    const list = [];

    if (mine.length > 0) {
      list.push({
        value: "mine",
        label: "На мне",
        short: "На мне",
        count: mine.length,
        rows: mine.slice(0, ROWS),
        meta: companyMeta,
        trailing: createdTrailing,
        note: mine.length > ROWS ? `Показаны ${ROWS} из ${mine.length}` : "",
      });
    }

    if (unassigned.length > 0) {
      list.push({
        value: "free",
        label: "Без ответственного",
        // На телефоне полная подпись в три сегмента не встаёт — та же уловка,
        // что у `TicketRow`: своя разметка под ширину, а не усечение.
        short: "Не назначены",
        count: unassigned.length,
        // Сначала то, за чем стоит человек: машинные заявки разбирают пачкой и
        // не срочно.
        rows: [...fromPeople, ...fromMachines].slice(0, ROWS),
        meta: (ticket) =>
          [companyMeta(ticket), ticket.source].filter(Boolean).join(" · "),
        trailing: createdTrailing,
        note: [
          unassigned.length > ROWS
            ? `Показаны ${ROWS} из ${unassigned.length}`
            : "",
          fromMachines.length > 0
            ? `${fromMachines.length} от мониторинга`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }

    if (stale.length > 0) {
      list.push({
        value: "stale",
        label: "Давно без движения",
        short: "Без движения",
        // Счётчик появился вместе с правилом: раньше это была верхушка
        // сортировки, и число означало бы «сколько строк нарисовано».
        count: stale.length,
        rows: stale.slice(0, ROWS),
        meta: companyMeta,
        trailing: (ticket) => (
          <span className="text-destructive">{silenceText(ticket)}</span>
        ),
        // Порог называем словами: иначе «12 дней» в строке не с чем сравнить.
        note: [
          thresholdDays > 0
            ? `Молчат дольше ${thresholdDays} ${plural(thresholdDays, "рабочего дня", "рабочих дней", "рабочих дней")}`
            : "",
          stale.length > ROWS ? `показаны ${ROWS} из ${stale.length}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }

    return list;
  }, [mine, unassigned, fromPeople, fromMachines, stale, thresholdDays]);

  if (!loaded || tabs.length === 0) return null;

  // Выбранный срез мог опуститься до нуля на очередном опросе (заявку взяли,
  // назначили) — тогда показываем первый живой, а не пустоту.
  const current = tabs.find((tab) => tab.value === selected) ?? tabs[0];

  const options = tabs.map(({ value, label, count }) => ({
    value,
    label,
    count,
  }));
  return (
    <section>
      <Eyebrow
        count={tabs.length > 1 ? tickets.length : current.count}
        action={
          tabs.length > 1 ? (
            <Segmented
              fit
              ariaLabel="Какие заявки"
              value={current.value}
              onChange={setSelected}
              options={options}
              className="max-md:hidden"
            />
          ) : undefined
        }
      >
        {tabs.length > 1 ? "Заявки" : current.label}
      </Eyebrow>

      {/* Телефон: очереди — чипы одной строкой с прокруткой (как фасеты
          уведомлений), а не сегмент: сегмент не умеет ни переноситься, ни
          прокручиваться и при крупном шрифте раздвигал колонку главной за
          экран. Полоса прокрутки скрыта, ряд выходит на поля страницы */}
      {tabs.length > 1 && (
        <div
          role="group"
          aria-label="Какие заявки"
          className="-mx-3 mb-2.5 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => (
            <FilterChip
              key={tab.value}
              size="sm"
              active={tab.value === current.value}
              onClick={() => setSelected(tab.value)}
              count={tab.count}
              className="flex-none"
            >
              {tab.short}
            </FilterChip>
          ))}
        </div>
      )}

      <Panel>
        <div className="-mx-4 -my-4 md:-mx-5 md:-my-5">
          {/* Телефон: та же строка, что на странице заявок (Ticket/Row.jsx),
              а не своя мини-строка — один формат заявки на всё приложение.
              Десктоп пока остаётся на компактной строке главной */}
          <div className="md:hidden">
            {current.rows.map((ticket) => (
              <TicketListRow
                key={ticket._id}
                ticket={ticket}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            ))}
          </div>
          <div className="max-md:hidden">
            {current.rows.map((ticket) => (
              <TicketRow
                key={ticket._id}
                ticket={ticket}
                meta={current.meta(ticket)}
                trailing={current.trailing(ticket)}
                unread={ticket.unread}
              />
            ))}
          </div>

          {/* Подвал считает показанное: «5 из 19» — обещание, и оно не должно
              расходиться с числом строк. Ссылка одна на все срезы: список
              заявок фильтр из адреса не принимает, а обещание, которого
              интерфейс не держит, хуже отсутствия ссылки. */}
          <div className="flex items-center gap-3 border-t border-border-soft px-4 py-2.5 text-sm text-muted-foreground tabular-nums md:px-5">
            {current.note}
            <Link
              to="/tickets"
              className="ms-auto font-medium text-accent-text no-underline"
            >
              Все заявки →
            </Link>
          </div>
        </div>
      </Panel>
    </section>
  );
};

export default StaffTickets;

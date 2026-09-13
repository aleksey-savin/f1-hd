import { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { RiArrowDownSLine, RiArrowUpSLine } from "react-icons/ri";

import { Eyebrow, Panel } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import useLiveTopic from "@/hooks/use-live-topic";
import { AuthedUserContext } from "../../store/authed-user-context";
import useDashboardTicketsStore from "../../store/dashboard-tickets";
import { formatShortDate } from "../../util/format-date";
import { toIsoDay } from "../../util/period";
import { createdText } from "../Ticket/ticket-state";
import TicketRow from "./TicketRow";
import { useCan } from "@/store/authed-user";

/**
 * «Мои заявки» на главной клиента — один блок с переключателем срезов:
 * «Активные» и «Закрытые за 30 дней».
 *
 * Закрытые здесь не ради полноты, а ради частого вопроса «что вы мне на той
 * неделе сделали»: за ним человек уходил в архив и там заново собирал фильтр.
 *
 * **За активными раздела нет.** Страницы «Заявки» у клиента нет (2026-09, см.
 * `layout/Navigation/menu.js`): блок и есть его список, поэтому хвост длиннее
 * шести строк раскрывается на месте («Показать все N»), а не уводит. У
 * закрытых ссылка по-прежнему ведёт в архив с уже проставленным фильтром.
 *
 * **Срезы — табы, а не стопка.** Раньше закрытые шли под открытыми, за
 * перемычкой посреди панели: две разные вещи в одном списке, причём открытые
 * было не свернуть, а закрытых помещалось три из девяти — счёт в перемычке
 * расходился с числом строк. Табы — тот же приём, что у заявок сотрудника
 * (`StaffTickets`): срезы делят одну панель и один вид строки, а каждый
 * получает её целиком.
 *
 * **Счётчик у метки — открытые**, как размер набора у сотрудника; сколько
 * закрыто за месяц, говорит подпись своего таба.
 *
 * Сегмент «Мои | Компании» появляется только у тех, кому бэкенд отдаёт заявки
 * всей компании (`canSeeAllCompanyTickets`, сейчас это 20 человек). Остальным
 * он не сужает ничего — и по правилу «переключатель, который не сужает, не
 * показываем» его нет. Ось у него своя (ЧЬИ заявки), у табов своя (КАКИЕ),
 * поэтому два сегмента рядом не спорят друг с другом.
 */

const CLOSED_DAYS = 30;
const ROWS = 6;

const FOOTER =
  "flex items-center gap-3 border-t border-border-soft px-5 py-2.5 text-sm text-muted-foreground tabular-nums";

const MyTicketsClient = () => {
  const { _id: userId } = useContext(AuthedUserContext);
  const can = useCan();
  const openTickets = useDashboardTicketsStore((state) => state.tickets);
  const loaded = useDashboardTicketsStore((state) => state.loaded);

  const canSeeCompany = !!can({ ticket: ["readCompanies"] });
  const [scope, setScope] = useState("mine");
  const [selected, setSelected] = useState("open");
  const [closed, setClosed] = useState([]);
  const [closedTotal, setClosedTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - CLOSED_DAYS * 24 * 60 * 60 * 1000);
    return { from: toIsoDay(from), to: toIsoDay(to) };
  }, []);

  // Свои заявки — параметром запроса, а не фильтром по приехавшему: `total`
  // считает сервер по своей выборке, и отфильтруй мы её на клиенте, подпись
  // таба говорила бы про компанию, а строки — про одного человека.
  const onlyMine = !canSeeCompany || scope === "mine";

  const loadClosed = async () => {
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      sort: "finished_desc",
      limit: String(ROWS),
    });
    if (onlyMine) params.set("applicants", String(userId));
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/closed?${params}`,
      );
      if (!response.ok) throw new Error(`closed ${response.status}`);
      const data = await response.json();
      setClosed(data.tickets ?? []);
      setClosedTotal(data.total ?? 0);
    } catch (error) {
      // Хвост блока: не приехал — открытые заявки всё равно на месте.
      console.error("Не удалось загрузить закрытые заявки:", error);
    }
  };

  useEffect(() => {
    loadClosed();
  }, [userId, onlyMine, range.from, range.to]);

  // Заявку закрыли — она переезжает из открытых в закрытые; открытые
  // перечитывает главная, закрытые — этот блок (docs/live-updates.md)
  useLiveTopic("tickets", loadClosed, { minIntervalMs: 30_000 });

  const open = useMemo(() => {
    if (!onlyMine) return openTickets;
    return openTickets.filter(
      (ticket) => String(ticket.applicant?._id) === String(userId),
    );
  }, [openTickets, onlyMine, userId]);

  const archiveParams = new URLSearchParams({ from: range.from, to: range.to });
  if (onlyMine) archiveParams.set("applicants", String(userId));

  const tabs = useMemo(() => {
    const list = [];

    if (open.length > 0) {
      list.push({
        value: "open",
        label: "Активные",
        count: open.length,
        total: open.length,
        // Раздела за активными нет — блок и есть список клиента, хвост
        // раскрывается на месте (см. подвал)
        rows: expanded ? open : open.slice(0, ROWS),
        row: (ticket) => ({
          ticket,
          meta: [ticket.category?.title, ticket.applicant?.lastName]
            .filter(Boolean)
            .join(" · "),
          trailing: createdText(ticket.createdAt),
          unread: ticket.unread,
        }),
      });
    }

    if (closed.length > 0) {
      list.push({
        value: "closed",
        label: "Закрытые за 30 дней",
        count: closedTotal,
        total: closedTotal,
        rows: closed.slice(0, ROWS),
        row: (ticket) => ({
          // Состояние закрытой заявки приезжает своим, но в блоке она всегда
          // «Закрыта»: выборка ручки — закрытые за период.
          ticket: { ...ticket, state: "Закрыта" },
          meta: [ticket.category?.title, ticket.company?.alias]
            .filter(Boolean)
            .join(" · "),
          trailing: formatShortDate(ticket.finishedAt),
        }),
        to: `/archive?${archiveParams}`,
        linkLabel: "Все закрытые →",
      });
    }

    return list;
    // archiveParams пересобирается каждый рендер — в зависимостях его строка
  }, [open, closed, closedTotal, expanded, archiveParams.toString()]);

  // Пустой блок на лендинге не рисуется вовсе — ни заголовка, ни заглушки.
  if (!loaded || tabs.length === 0) return null;

  // Выбранный срез мог опустеть на очередном опросе (заявку закрыли) — тогда
  // показываем первый живой, а не пустоту.
  const current = tabs.find((tab) => tab.value === selected) ?? tabs[0];

  const controls = (compact) => (
    <>
      {canSeeCompany && (
        <Segmented
          fit
          compact={compact}
          ariaLabel="Чьи заявки"
          value={scope}
          onChange={setScope}
          options={[
            { value: "mine", label: "Мои" },
            { value: "company", label: "Компании" },
          ]}
        />
      )}
      {tabs.length > 1 && (
        <Segmented
          fit
          compact={compact}
          ariaLabel="Какие заявки"
          value={current.value}
          onChange={setSelected}
          options={tabs.map(({ value, label, count }) => ({
            value,
            label,
            count,
          }))}
        />
      )}
    </>
  );

  const hasControls = canSeeCompany || tabs.length > 1;

  return (
    <section>
      {/* Когда живой срез один, переключателя нет и метка называет сам срез:
          «Мои заявки» над одними закрытыми не сказали бы, что они закрытые */}
      <Eyebrow
        count={tabs.length > 1 ? open.length || undefined : current.count}
        action={
          hasControls ? (
            <span className="flex items-center gap-2 max-md:hidden">
              {controls(false)}
            </span>
          ) : undefined
        }
      >
        {tabs.length > 1 || current.value === "open"
          ? "Мои заявки"
          : current.label}
      </Eyebrow>

      {/* Телефон: переключатели своей строкой — рядом с меткой секции два
          сегмента на 366 px не помещаются */}
      {hasControls && (
        <div className="mb-2.5 flex flex-wrap gap-2 md:hidden">
          {controls(true)}
        </div>
      )}

      <Panel>
        {/* Без подвала последняя строка упирается в скруглённый угол панели —
            подсветка строки не должна из него выпирать */}
        <div className="-mx-5 -my-5 overflow-hidden rounded-[inherit]">
          {current.rows.map((ticket) => {
            const props = current.row(ticket);
            return <TicketRow key={ticket._id} {...props} />;
          })}

          {/* Подвал считает показанное: «6 из 9» — обещание, и оно не должно
              расходиться с числом строк. Закрытые уходят в архив с уже
              проставленными периодом и заявителем; у активных раздела нет —
              блок и есть список клиента, и хвост раскрывается на месте. Шести
              строкам без хвоста подвал не нужен вовсе */}
          {current.to ? (
            <div className={FOOTER}>
              {current.total > current.rows.length &&
                `Показаны ${current.rows.length} из ${current.total}`}
              <Link
                to={current.to}
                className="ms-auto font-medium text-accent-text no-underline"
              >
                {current.linkLabel}
              </Link>
            </div>
          ) : (
            current.total > ROWS && (
              <div className={FOOTER}>
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="ms-auto inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 font-medium text-accent-text outline-none hover:underline focus-visible:underline"
                >
                  {expanded ? "Свернуть" : `Показать все ${current.total}`}
                  {expanded ? (
                    <RiArrowUpSLine aria-hidden />
                  ) : (
                    <RiArrowDownSLine aria-hidden />
                  )}
                </button>
              </div>
            )
          )}
        </div>
      </Panel>
    </section>
  );
};

export default MyTicketsClient;

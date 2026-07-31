import { useContext, useEffect, useRef, useState } from "react";

import { useFetcher } from "react-router";
import {
  RiAddLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiListCheck2,
  RiQuestionLine,
  RiRefreshLine,
  RiSendPlaneLine,
  RiSparkling2Line,
} from "react-icons/ri";

import { Eyebrow, Panel, Section, SubLabel } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import useHttp from "../../../hooks/use-http";
import { AuthedUserContext } from "../../../store/authed-user-context";
import useViewTicketStore from "../../../store/view-ticket";
import { getLocalStorageData } from "../../../util/auth";
import { formatDate } from "../../../util/format-date";
import { getNoteTypeMeta } from "../../../util/knowledgeNoteTypes";

/**
 * Руководство ИИ по заявке.
 *
 * Панель не ведёт свой чек-лист. Разбор живых данных: в 99 собранных
 * руководствах около 980 пунктов, а отмечено за всё время 10 — кольцо прогресса,
 * полоса и галочки обслуживали механику, которой никто не пользовался. Пункты
 * стали текстом, а отметки живут там, где и должны: в чек-листе заявки, куда
 * шаги переносятся одним действием.
 *
 * Три из четырёх готовых руководств — не решение, а вопросы («не хватает
 * данных»). Это основной случай, поэтому у него своё действие: вопросы
 * складываются черновиком в поле комментария, где их правят и отправляют.
 * Отправлять сами не пробуем — десять вопросов от ИИ клиенту как есть не
 * посылают.
 *
 * Подбора категории здесь нет: категория определяется автоматически при
 * создании заявки и при разборе письма (services/ticketCategoryService).
 */

const POLL_INTERVAL = 4000;

// Больше шести пунктов — сворачиваем (в среднем их десять, максимум 18)
const VISIBLE_LIMIT = 5;
const COLLAPSE_FROM = 6;

// Письмо клиенту начинается приветствием, а не списком вопросов
const ASK_INTRO = "Добрый день! Чтобы продолжить, уточните, пожалуйста:";

// Причину бэкенд теперь пишет человеческой фразой (services/aiErrors), но у
// заявок, где руководство падало раньше, в поле лежит сырой ответ поставщика —
// такой текст не показываем
const readableError = (error) => {
  if (!error || error.includes("{") || error.length > 160) return "";
  return error;
};

const SourceRow = ({ source }) => {
  const typeMeta = getNoteTypeMeta(source.type);
  const TypeIcon = typeMeta.icon;

  // Не app/NoteItem: у источника есть только _id, заголовок и тип — ни даты, ни
  // привязок, ни состояния проверки, а открываться он должен в новой вкладке
  return (
    <a
      href={`/knowledge-base/${source._id}`}
      target="_blank"
      rel="noreferrer"
      className="tw:flex tw:items-center tw:gap-2.5 tw:rounded-lg tw:px-2 tw:py-1.5 tw:text-foreground tw:no-underline tw:transition-colors tw:hover:bg-accent tw:hover:text-foreground"
    >
      <TypeIcon
        size={16}
        aria-hidden
        title={typeMeta.label}
        className="tw:flex-none tw:text-faint"
      />
      <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-sm">
        {source.title}
      </span>
      <RiExternalLinkLine
        size={14}
        aria-hidden
        className="tw:flex-none tw:text-faint"
      />
    </a>
  );
};

const AiGuideSection = () => {
  const { token } = getLocalStorageData();
  const { permissions } = useContext(AuthedUserContext);

  const ticket = useViewTicketStore((state) => state.ticket);
  const updateTicket = useViewTicketStore((state) => state.updateTicket);
  const pushCommentDraft = useViewTicketStore(
    (state) => state.pushCommentDraft,
  );

  const checklistFetcher = useFetcher();
  const { isLoading, error: requestError, sendRequest } = useHttp();
  const [showAll, setShowAll] = useState(false);

  const aiGuide = ticket?.aiGuide;
  const status = aiGuide?.status || "idle";
  const items = aiGuide?.items ?? [];
  const sources = aiGuide?.sources ?? [];
  const isQuestions = aiGuide?.kind === "questions";
  const busy = isLoading || status === "pending";

  const canGenerate = permissions?.canPerformTickets && !ticket?.isArchived;
  const canEditChecklist = permissions?.canEditTickets && !ticket?.isArchived;

  const applyGuide = (guide) => {
    const current = useViewTicketStore.getState().ticket;
    updateTicket({ ...current, aiGuide: guide });
  };

  // Сборка идёт в фоне — опрашиваем заявку, пока статус pending
  const pollRef = useRef(null);
  useEffect(() => {
    if (status !== "pending" || !ticket?.num) return undefined;

    const poll = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) return;
        const data = await response.json();
        const next = data.ticket?.aiGuide;
        if (next?.status && next.status !== "pending") applyGuide(next);
      } catch {
        // сеть моргнула — продолжаем опрашивать
      }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [status, ticket?.num, token]);

  const generate = () =>
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-guide/generate`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: { _id: ticket._id },
      },
      (data) => {
        if (data.aiGuide) applyGuide(data.aiGuide);
      },
    );

  // Вопросы уезжают черновиком в поле комментария хроники: там их правят и
  // отправляют сами
  const askAll = () =>
    pushCommentDraft(
      [
        ASK_INTRO,
        "",
        ...items.map((item, index) => `${index + 1}. ${item.text}`),
      ].join("\n"),
    );

  const askOne = (item) => pushCommentDraft(item.text);

  // Шаги дописываются в конец существующего чек-листа: сервер поднимает отметки
  // сохранённых пунктов по _id, поэтому перенос ничего не затирает
  const toChecklist = () =>
    checklistFetcher.submit(
      {
        intent: "updateChecklist",
        ticketNum: ticket.num,
        source: "ai",
        checklist: JSON.stringify([
          ...(ticket.checklist ?? []).map((entry) => ({
            _id: entry._id,
            description: entry.description,
            mandatory: !!entry.mandatory,
          })),
          ...items.map((item) => ({
            description: item.text,
            mandatory: false,
          })),
        ]),
      },
      { method: "POST", action: `/tickets/${ticket.num}` },
    );

  const visible = showAll ? items : items.slice(0, VISIBLE_LIMIT);

  const action =
    canGenerate &&
    status !== "pending" &&
    (status === "idle" ? (
      <Button variant="outline" size="xs" disabled={busy} onClick={generate}>
        <RiSparkling2Line /> Собрать руководство
      </Button>
    ) : (
      <Button variant="outline" size="xs" disabled={busy} onClick={generate}>
        <RiRefreshLine /> Собрать заново
      </Button>
    ));

  return (
    <Section>
      <Eyebrow
        id="ticket-ai"
        count={status === "ready" ? items.length || undefined : undefined}
        action={action}
      >
        Руководство ИИ
      </Eyebrow>
      <Panel>
        {status === "idle" && (
          <div className="tw:flex tw:items-start tw:gap-2.5 tw:text-sm tw:text-muted-foreground">
            <RiSparkling2Line
              size={16}
              aria-hidden
              className="tw:mt-0.5 tw:flex-none tw:text-faint"
            />
            <span>
              Руководство не собрано. ИИ прочитает заявку, переписку, базу
              знаний и прошлые заявки компании и предложит, что делать.
            </span>
          </div>
        )}

        {status === "pending" && (
          <div className="tw:flex tw:items-center tw:gap-2.5 tw:text-sm tw:text-muted-foreground">
            <RiSparkling2Line
              size={16}
              aria-hidden
              className="tw:flex-none tw:animate-pulse tw:text-accent-text"
            />
            Читаем заявку и базу знаний…
          </div>
        )}

        {status === "error" && (
          <div className="tw:flex tw:items-start tw:gap-2.5 tw:rounded-lg tw:bg-destructive/10 tw:px-3 tw:py-2.5 tw:text-sm tw:text-destructive">
            <RiErrorWarningLine
              size={16}
              aria-hidden
              className="tw:mt-0.5 tw:flex-none"
            />
            <span>
              Не удалось собрать руководство
              {readableError(aiGuide?.error)
                ? `: ${readableError(aiGuide.error)}.`
                : "."}{" "}
              Подробности — в хронике заявки.
            </span>
          </div>
        )}

        {requestError && status !== "error" && status !== "pending" && (
          <div className="tw:mt-2 tw:text-sm tw:text-destructive">
            Не удалось отправить запрос. Проверьте соединение и попробуйте
            снова.
          </div>
        )}

        {status === "ready" && (
          <>
            {isQuestions && (
              <div className="tw:mb-3 tw:flex tw:items-start tw:gap-2.5 tw:text-sm tw:text-warning">
                <RiQuestionLine
                  size={16}
                  aria-hidden
                  className="tw:mt-0.5 tw:flex-none"
                />
                <span>
                  <b className="tw:font-semibold">
                    Не хватает данных, чтобы предложить решение.
                  </b>{" "}
                  Уточните у заявителя вопросы ниже.
                </span>
              </div>
            )}

            {aiGuide.summary && (
              <p className="tw:mt-0 tw:mb-3.5 tw:text-[0.9375rem] tw:leading-relaxed">
                {aiGuide.summary}
              </p>
            )}

            {items.length > 0 && (
              <>
                <SubLabel
                  count={items.length}
                  action={
                    isQuestions
                      ? permissions?.canPerformTickets && (
                          <Button variant="outline" size="xs" onClick={askAll}>
                            <RiSendPlaneLine /> Спросить заявителя
                          </Button>
                        )
                      : canEditChecklist && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={checklistFetcher.state !== "idle"}
                            onClick={toChecklist}
                          >
                            {/* Пока чек-листа нет, шаги руководства его
                                СОСТАВЛЯЮТ — это и есть самый дешёвый способ
                                завести чек-лист: ни одного придуманного пункта.
                                Когда список уже есть, шаги в него дописываются */}
                            <RiListCheck2 />
                            {ticket.checklist?.length > 0
                              ? "Дополнить чек-лист"
                              : "Составить чек-лист"}
                          </Button>
                        )
                  }
                >
                  {isQuestions ? "Что спросить" : "Шаги решения"}
                </SubLabel>

                <ol className="tw:m-0 tw:list-none tw:p-0">
                  {visible.map((item, index) => (
                    <li
                      key={index}
                      className={cn(
                        "tw:group tw:flex tw:items-start tw:gap-2.5 tw:rounded-lg tw:py-1 tw:transition-colors",
                        isQuestions && "tw:hover:bg-accent/60",
                      )}
                    >
                      <span className="tw:min-w-4.5 tw:flex-none tw:pt-0.5 tw:text-sm tw:text-faint tw:tabular-nums">
                        {index + 1}.
                      </span>
                      <span className="tw:min-w-0 tw:flex-1 tw:text-sm tw:leading-relaxed">
                        {item.text}
                      </span>
                      {/* Из десяти вопросов обычно нужны два — «+» дописывает
                          в черновик именно этот */}
                      {isQuestions && permissions?.canPerformTickets && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Дописать вопрос в комментарий"
                          aria-label="Дописать вопрос в комментарий"
                          className="tw:flex-none tw:text-faint tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:pointer-coarse:opacity-100"
                          onClick={() => askOne(item)}
                        >
                          <RiAddLine />
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>

                {!showAll && items.length >= COLLAPSE_FROM && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="tw:mt-1"
                    onClick={() => setShowAll(true)}
                  >
                    Показать все {items.length}
                  </Button>
                )}
              </>
            )}

            {sources.length > 0 && (
              <div className="tw:mt-4">
                <SubLabel count={sources.length}>Источники</SubLabel>
                <div className="tw:-mx-2">
                  {sources.map((source) => (
                    <SourceRow key={source._id} source={source} />
                  ))}
                </div>
              </div>
            )}

            {/* Тихая атрибуция: свежесть руководства и видел ли ИИ переписку */}
            <div className="tw:mt-3.5 tw:flex tw:flex-wrap tw:gap-x-2.5 tw:gap-y-1 tw:border-t tw:border-border-soft tw:pt-2.5 tw:text-xs tw:text-faint">
              {(aiGuide.provider || aiGuide.model) && (
                <span>
                  {[aiGuide.provider, aiGuide.model]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
              {aiGuide.generatedAt && (
                <span>собрано {formatDate(aiGuide.generatedAt)}</span>
              )}
              {aiGuide.generatedFromCommentCount > 0 && (
                <span>
                  учтено комментариев: {aiGuide.generatedFromCommentCount}
                </span>
              )}
            </div>
          </>
        )}
      </Panel>
    </Section>
  );
};

export default AiGuideSection;

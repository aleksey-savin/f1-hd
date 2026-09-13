import { useEffect, useState } from "react";

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
import useViewTicketStore from "../../../store/view-ticket";
import usePulseStore from "@/store/pulse";
import { formatDate } from "../../../util/format-date";
import { getNoteTypeMeta } from "../../../util/knowledgeNoteTypes";
import { useCan } from "@/store/authed-user";

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

const PENDING_PULSE_MS = 4000;

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
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-foreground no-underline transition-colors hover:bg-accent hover:text-foreground"
    >
      <TypeIcon
        size={16}
        aria-hidden
        title={typeMeta.label}
        className="flex-none text-faint"
      />
      <span className="min-w-0 flex-1 truncate text-sm">{source.title}</span>
      <RiExternalLinkLine
        size={14}
        aria-hidden
        className="flex-none text-faint"
      />
    </a>
  );
};

const AiGuideSection = ({ canEditChecklist = false }) => {
  const can = useCan();

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

  const canGenerate = can({ ticket: ["perform"] }) && !ticket?.isArchived;

  const applyGuide = (guide) => {
    const current = useViewTicketStore.getState().ticket;
    updateTicket({ ...current, aiGuide: guide });
  };

  // Сборка идёт в фоне. Готовое руководство записывается в заявку, и карточка
  // перечитывается по пульсу сама (pages/Ticket/View) — здесь только просим
  // пульс ходить чаще, пока ждём, чтобы результат не опаздывал на 10 секунд
  useEffect(() => {
    if (status !== "pending") return undefined;
    return usePulseStore.getState().requestCadence(PENDING_PULSE_MS);
  }, [status]);

  const generate = () =>
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-guide/generate`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
          <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <RiSparkling2Line
              size={16}
              aria-hidden
              className="mt-0.5 flex-none text-faint"
            />
            <span>
              Руководство не собрано. ИИ прочитает заявку, переписку, базу
              знаний и прошлые заявки компании и предложит, что делать.
            </span>
          </div>
        )}

        {status === "pending" && (
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <RiSparkling2Line
              size={16}
              aria-hidden
              className="flex-none animate-pulse text-accent-text"
            />
            Читаем заявку и базу знаний…
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <RiErrorWarningLine
              size={16}
              aria-hidden
              className="mt-0.5 flex-none"
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
          <div className="mt-2 text-sm text-destructive">
            Не удалось отправить запрос. Проверьте соединение и попробуйте
            снова.
          </div>
        )}

        {status === "ready" && (
          <>
            {isQuestions && (
              <div className="mb-3 flex items-start gap-2.5 text-sm text-warning">
                <RiQuestionLine
                  size={16}
                  aria-hidden
                  className="mt-0.5 flex-none"
                />
                <span>
                  <b className="font-semibold">
                    Не хватает данных, чтобы предложить решение.
                  </b>{" "}
                  Уточните у заявителя вопросы ниже.
                </span>
              </div>
            )}

            {aiGuide.summary && (
              <p className="mt-0 mb-3.5 text-sm leading-relaxed">
                {aiGuide.summary}
              </p>
            )}

            {items.length > 0 && (
              <>
                <SubLabel
                  count={items.length}
                  action={
                    isQuestions
                      ? can({ ticket: ["perform"] }) && (
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

                <ol className="m-0 list-none p-0">
                  {visible.map((item, index) => (
                    <li
                      key={index}
                      className={cn(
                        "group flex items-start gap-2.5 rounded-lg py-1 transition-colors",
                        isQuestions && "hover:bg-accent/60",
                      )}
                    >
                      <span className="min-w-4.5 flex-none pt-0.5 text-sm text-faint tabular-nums">
                        {index + 1}.
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-relaxed">
                        {item.text}
                      </span>
                      {/* Из десяти вопросов обычно нужны два — «+» дописывает
                          в черновик именно этот */}
                      {isQuestions && can({ ticket: ["perform"] }) && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Дописать вопрос в комментарий"
                          aria-label="Дописать вопрос в комментарий"
                          className="flex-none text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
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
                    className="mt-1"
                    onClick={() => setShowAll(true)}
                  >
                    Показать все {items.length}
                  </Button>
                )}
              </>
            )}

            {sources.length > 0 && (
              <div className="mt-4">
                <SubLabel count={sources.length}>Источники</SubLabel>
                <div className="-mx-2">
                  {sources.map((source) => (
                    <SourceRow key={source._id} source={source} />
                  ))}
                </div>
              </div>
            )}

            {/* Тихая атрибуция: свежесть руководства и видел ли ИИ переписку */}
            <div className="mt-3.5 flex flex-wrap gap-x-2.5 gap-y-1 border-t border-border-soft pt-2.5 text-xs text-faint">
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

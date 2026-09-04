import { useContext, useEffect, useMemo, useState } from "react";

import {
  Link,
  Outlet,
  useFetcher,
  useFetchers,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { BrowserView } from "react-device-detect";
import {
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiMoreLine,
  RiRepeat2Line,
} from "react-icons/ri";

import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import AnchorRail from "@/components/app/AnchorRail";
import Checklist from "@/components/app/Checklist";
import { DeleteDialog } from "@/components/app/DeleteItem";
import Environment from "@/components/app/Environment";
import FormSheet from "@/components/app/FormSheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import AiGuideSection from "../../components/Ticket/View/AiGuideSection";
import AiMark from "../../components/Ticket/View/AiMark";
import AttachmentStrip, {
  useAttachments,
} from "../../components/Ticket/View/AttachmentStrip";
import {
  TemplateOffer,
  TemplatePicker,
  useChecklistTemplates,
} from "../../components/Ticket/View/ChecklistTemplates";
import Chronicle from "../../components/Ticket/Chronicle";
import CompanyLogsOffcanvas from "../../components/CompanyLogs/Offcanvas";
import CustomFieldsView from "@/components/app/CustomFieldsView";
import KnowledgeSection from "../../components/Ticket/View/KnowledgeSection";
import RemoteAccess from "../../components/Ticket/View/RemoteAccess";
import ActionDialog from "../../components/Ticket/Actions/ActionDialog";
import {
  Eyebrow,
  Panel,
  Section,
  SectionEditButton,
} from "@/components/app/Panel";
import {
  DescriptionSection,
  FactsSection,
  WorksSection,
} from "../../components/Ticket/View/Sections";
import {
  DIALOG_ACTIONS,
  ticketActions,
} from "../../components/Ticket/ticket-actions";
import {
  TicketStateText,
  deadlineText,
  isOverdue,
  ticketTone,
} from "../../components/Ticket/ticket-state";
import usePolling from "../../hooks/use-polling";
import { AuthedUserContext } from "../../store/authed-user-context";
import useInitialPrefsStore from "../../store/prefs";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import useViewTicketStore from "../../store/view-ticket";
import { getLocalStorageData } from "../../util/auth";
import { useCan } from "@/store/authed-user";

// Карточка заявки: hero (номер · тема · статус фразой · одно действие по
// состоянию и «⋯») → слева секции с липким рейлом-якорем, справа хроника.
//
// Вкладок нет: семь вкладок были семью экранами в одном. Хроника заменила и
// колонку комментариев, и вкладку «Лог» — события и переписка идут одной лентой,
// а служебные записи сворачивает бэкенд (см. services/ticketEvents.js).
//
// Высота правой колонки — sticky + свой скролл; прежняя карточка считала её в JS
// от window.innerWidth и слушателя resize.

// Слепок «значимого» состояния заявки: меняется — тихо ревалидируем loader.
// Комментарии и события живут отдельно от ticket.updatedAt, поэтому считаем их
// явно, иначе чужой комментарий или новое событие не подтянутся.
const ticketSignature = (data) =>
  [
    data?.ticket?.updatedAt,
    data?.ticket?.state,
    data?.ticket?.deadline,
    data?.ticket?.comments?.length,
    data?.ticket?.responsibles?.length,
    data?.ticket?.checklist
      ?.map((item) => `${item._id}:${item.checked}`)
      .join(","),
    data?.ticket?.aiSpeech?.status,
    data?.ticket?.aiCategory?.status,
    data?.ticket?.aiGuide?.status,
    data?.events?.length,
  ].join("|");

const ViewTicket = () => {
  const data = useLoaderData();
  const { ticketData, responsiblesData } = data;
  const { ticket, company, works, events = [] } = ticketData;

  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const revalidator = useRevalidator();
  const fetchers = useFetchers();
  const checklistFetcher = useFetcher();
  const { modules, ai } = useInitialPrefsStore();
  const authedUser = useContext(AuthedUserContext);
  const { _id: userId, isEndUser, isAdmin } = authedUser;
  const can = useCan();

  const { showToast } = useToastStore();

  const store = useViewTicketStore();
  useEffect(() => {
    store.updateTicket(ticket);
    store.updateCompany(company);
    store.updateResponsibles(responsiblesData);
    store.updateComments(ticket.comments ?? []);
    store.updateWorks(works);
    store.updateOtherCompanyTickets(data.otherCompanyTickets);
  }, [ticket, company, works, responsiblesData, data.otherCompanyTickets]);

  // Карточку всегда открываем от начала: Root сбрасывает только мобильный
  // контейнер, а window-скролл при навигации сохраняется
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Вложения живут лентой в подвале описания: состояние (список, загрузка,
  // удаление) держит хук, а кнопка «Прикрепить» уходит в метку секции
  const attachments = useAttachments(ticket);

  const [dialog, setDialog] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [logsQuery, setLogsQuery] = useState(null);
  const [checklistEdit, setChecklistEdit] = useState(false);
  const [scrollToChecklist, setScrollToChecklist] = useState(false);
  // Окружение прячется целиком, когда сопоставлять нечего: виджет сам знает,
  // что приехало с сервера, а метку и панель рисует страница
  const [environmentEmpty, setEnvironmentEmpty] = useState(false);

  // Секция только что смонтировалась — переносим к ней и ставим курсор в поле
  useEffect(() => {
    if (!scrollToChecklist) return;
    setScrollToChecklist(false);

    const anchor = document.getElementById("ticket-checklist");
    anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
    // preventScroll: фокус без него отменяет плавную прокрутку и швыряет
    // страницу рывком. У поля добавления пункта нет type — селектор общий
    anchor?.parentElement?.querySelector("input")?.focus({
      preventScroll: true,
    });
  }, [scrollToChecklist]);

  // Переход на соседнюю заявку не размонтирует страницу — режим правки от
  // прошлой заявки нужно снимать руками
  useEffect(() => {
    setChecklistEdit(false);
  }, [ticket.num]);

  // Состав чек-листа уходит на сервер после каждого изменения: «Готово» только
  // выходит из режима, поэтому кнопки «Сохранить» у секции нет.
  const saveChecklist = (items) =>
    checklistFetcher.submit(
      {
        intent: "updateChecklist",
        ticketNum: ticket.num,
        checklist: JSON.stringify(
          items.map((item) => ({
            _id: item._id,
            description: item.description,
            mandatory: !!item.mandatory,
          })),
        ),
      },
      { method: "POST", action: `/tickets/${ticket.num}` },
    );

  const overdue = isOverdue(ticket);
  const state = ticketTone(ticket);
  const mine = (ticket.responsibles ?? []).some(
    (user) => user._id?.toString() === userId?.toString(),
  );
  const { primary, menu } = ticketActions(ticket, {
    userId,
    can,
    isAdmin,
    isEndUser,
    works,
  });

  // Фоновое автообновление: не вмешиваемся во время сабмита действия и при
  // открытой шторке формы, чтобы не затереть ввод.
  const hasActiveFetcher = fetchers.some((f) => f.state !== "idle");
  usePolling(
    async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}`,
        );
        if (!response.ok) return;
        const fresh = await response.json();
        if (ticketSignature(fresh) !== ticketSignature(ticketData)) {
          revalidator.revalidate();
        }
      } catch (error) {
        console.error("Ticket auto-update poll failed:", error);
      }
    },
    {
      intervalMs: 15000,
      // Правка чек-листа идёт прямо в секции — ответ сервера перетёр бы
      // незаконченный ввод, как и открытая форма
      enabled:
        revalidator.state === "idle" &&
        !hasActiveFetcher &&
        !offcanvas.isActive &&
        !checklistEdit,
    },
  );

  const canPerform =
    can({ ticket: ["perform"] }) && mine && !ticket.isArchived;
  const canEditChecklist = can({ ticket: ["update"] }) && !ticket.isArchived;
  const hasChecklist = ticket.checklist?.length > 0;

  // Шаблоны чек-листов, подходящие этой заявке: ранжирование («побеждает самый
  // узкий») считает сервер, здесь только показ
  // Как заявка назовётся в крошке регламента, куда ведёт ссылка в чек-листе
  const fromState = useCrumbFrom(`Заявка №${ticket.num}`);
  const templates = useChecklistTemplates(ticket.num, canEditChecklist);
  const checklistHasChecks = (ticket.checklist ?? []).some(
    (item) => item.checked,
  );

  // Применение и смена идут тем же update-checklist: сервер поднимает отметки
  // совпавших по названию пунктов, поэтому смена шаблона не теряет отмеченное
  const applyTemplate = (template) => {
    // Редактор в режиме edit намеренно не читает пропсы (локальный черновик —
    // источник правды, иначе дёргается drag), поэтому внешнюю замену состава он
    // не увидит. Выходим из режима: шаблон на то и готовый список, что править
    // его сразу не надо, а карандаш рядом
    setChecklistEdit(false);
    if (template?.items?.length) {
      showToast("success", `Чек-лист «${template.title}» применён`);
    }

    return checklistFetcher.submit(
      {
        intent: "updateChecklist",
        ticketNum: ticket.num,
        templateTitle: template?.title ?? "",
        checklist: JSON.stringify(
          (template?.items ?? []).map((item) => ({
            description: item.description,
            mandatory: !!item.mandatory,
          })),
        ),
      },
      { method: "POST", action: `/tickets/${ticket.num}` },
    );
  };

  const showWorks =
    modules.timeTracking?.isActive && can({ work: ["read"] });
  const showEnvironment =
    !isEndUser &&
    modules.inventory?.isActive &&
    can({ device: ["read"] });
  const showKnowledge =
    modules.knowledgeBase?.isActive && can({ knowledge: ["read"] });
  const showAi = !isEndUser && ai?.isActive;

  const railSections = useMemo(
    () =>
      [
        // Порядок обязан совпадать с разметкой ниже — рейл ведёт по секциям,
        // а не по своему списку
        // Вложения — часть описания, своей секции и пункта рейла у них нет
        { id: "ticket-description", label: "Описание" },
        ticket.customFields?.length && {
          id: "ticket-fields",
          label: "Поля формы",
        },
        { id: "ticket-facts", label: "Детали" },
        // Руководство идёт сразу за фактами: оно отвечает «что делать», за этим
        // и открывают чужую заявку. Но не раньше «Деталей» — компания,
        // заявитель и ответственный это факты, а руководство предложение
        showAi && { id: "ticket-ai", label: "Руководство ИИ" },
        // Чек-лист есть у 3 % заявок — пустой пункт рейла вёл бы к строке
        // «Чек-листа нет»
        hasChecklist && { id: "ticket-checklist", label: "Чек-лист" },
        showWorks && { id: "ticket-works", label: "Работы" },
        showEnvironment &&
          !environmentEmpty && {
            id: "ticket-environment",
            label: "Окружение",
          },
        showKnowledge && { id: "ticket-knowledge", label: "База знаний" },
      ].filter(Boolean),
    [
      ticket.customFields?.length,
      hasChecklist,
      environmentEmpty,
      showWorks,
      showEnvironment,
      showKnowledge,
      showAi,
    ],
  );

  const pickAction = (key) => {
    // Секции у пустого чек-листа нет — пункт меню сразу открывает её в режиме
    // правки, с одной пустой строкой
    if (key === "makeChecklist") {
      setChecklistEdit(true);
      // Секции у пустого чек-листа нет — она появляется только сейчас, и без
      // переноса человек остаётся смотреть на прежний экран
      setScrollToChecklist(true);
      return;
    }
    if (DIALOG_ACTIONS.includes(key)) return setDialog(key);
    if (key === "delete") return setDeleteOpen(true);
    // «Обработать» — такая же форма заявки, как правка, только с другой
    // подписью сабмита, поэтому и открывается так же: маршрутом в шторке
    if (key === "update" || key === "process" || key === "addWork") {
      offcanvas.setShow();
      navigate(key === "addWork" ? "work/add" : key);
    }
  };

  return (
    <div className="mx-auto w-full max-w-8xl">
      <Crumbs section={ticket.isArchived ? "archive" : "tickets"} />

      {ticket.isArchived && (
        <Alert variant="warning" className="mb-4">
          <RiErrorWarningLine />
          <AlertDescription>
            Заявка в архиве и привязана к отчёту за период — правка и новые
            работы запрещены.
          </AlertDescription>
        </Alert>
      )}

      {/* HERO */}
      <div className="mb-6 flex flex-wrap items-start gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1">
          {/* Номер, статус и срок — одной строкой над темой: разнесённые по
              разным строкам, они читались как три независимых сообщения */}
          {/* Разделительных «·» здесь нет: текстовая точка сидит на высоте
              строчных, а точка статуса — по центру строки, и рядом они читаются
              как две разные точки. Разделяет расстояние */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold text-muted-foreground tabular-nums">
              № {ticket.num}
            </span>
            <TicketStateText tone={state.tone} strong>
              {state.label}
            </TicketStateText>
            {/* Просрочка — второй знак рядом со статусом, а не вместо него;
                слово и срок одного цвета, чтобы читались одной мыслью */}
            {overdue ? (
              <span className="text-destructive">
                <span className="font-semibold">просрочена</span> ·{" "}
                {deadlineText(ticket.deadline)}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {deadlineText(ticket.deadline)}
              </span>
            )}
          </div>
          <h1 className="mt-1.5 mb-0 text-2xl leading-tight font-semibold tracking-tight break-words">
            {ticket.title}
            {/* Третье место, где ИИ заполнил поле заявки вместо человека:
                заявитель темы не пишет, а она уезжает в список, в письмо,
                в Telegram и в отчёты */}
            {!isEndUser && ticket.aiTitle?.status === "processed" && (
              <span className="ms-1.5 align-middle">
                <AiMark
                  ticketId={ticket._id}
                  target="title"
                  hint="Тему написал ИИ по описанию заявки"
                  title="Что не так в теме?"
                  scope="тем заявок этой компании"
                />
              </span>
            )}
          </h1>
        </div>

        <div className="flex flex-none items-center gap-2">
          {primary && (
            <Button onClick={() => pickAction(primary.key)}>
              {primary.label}
            </Button>
          )}
          {/* Подключение к экрану: своя механика (запрос сессии → ссылка),
              показывает себя само только у заявки «В работе» */}
          <RemoteAccess ticket={ticket} />
          {menu.length > 0 && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  title="Действия"
                  aria-label="Действия"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              {/* Сплошной список: групп на пять пунктов не бывает, а
                  заголовки съедали половину высоты меню. Разрушающее —
                  последним и отбито разделителем */}
              <DropdownMenuContent align="end" className="w-56">
                {menu.map((item, index) => (
                  <div key={item.key}>
                    {item.danger && index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      variant={item.danger ? "destructive" : undefined}
                      onSelect={() => pickAction(item.key)}
                    >
                      {item.danger && <RiDeleteBinLine />}
                      {item.label}
                    </DropdownMenuItem>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Предложение чек-листа — отдельной строкой между шапкой и раскладкой:
          внутри колонки секций оно терялось, а первым блоком колонки вставало
          на одну линию с темой заявки и отжимало описание */}
      {canEditChecklist &&
        !hasChecklist &&
        !checklistEdit &&
        !ticket.routineTask && (
          <div className="mb-5">
            <TemplateOffer
              ticketNum={ticket.num}
              templates={templates}
              onApply={applyTemplate}
            />
          </div>
        )}

      {/* КАРКАС */}
      <div className="flex items-start gap-6">
        <BrowserView className="contents">
          <AnchorRail sections={railSections} ariaLabel="Разделы карточки" />
        </BrowserView>

        {/* -mt-6 гасит верхний отступ первой метки секции (у Eyebrow он mt-6):
            иначе колонка секций начинается на 24px ниже рейла и хроники */}
        <div className="-mt-6 flex min-w-0 flex-1 flex-col gap-5">
          <DescriptionSection
            ticket={ticket}
            canEdit={can({ ticket: ["update"] }) && !ticket.isArchived}
            uploadAction={attachments.uploadAction}
            attachments={
              <AttachmentStrip
                attachments={attachments.attachments}
                onRemove={attachments.remove}
                canDelete={attachments.canDelete}
                canTranscribe={attachments.canTranscribe}
                ticketNum={attachments.ticketNum}
              />
            }
          />

          {ticket.customFields?.length > 0 && (
            <Section>
              <span id="ticket-fields" className="block scroll-mt-28" />
              <CustomFieldsView fields={ticket.customFields} />
            </Section>
          )}

          <FactsSection
            ticket={ticket}
            company={company}
            canEdit={can({ ticket: ["update"] }) && !ticket.isArchived}
            onShowLogs={
              !isEndUser ? (query) => setLogsQuery(query ?? "") : undefined
            }
          />

          {showAi && <AiGuideSection />}

          {/* Секция появляется вместе с содержимым: пустой чек-лист — это блок,
              который сообщает только о своём отсутствии, а он бывает пустым у
              97 заявок из 100. Вход в составление — пункт «⋯»-меню, он же
              включает режим правки.

              Чек-лист правится в самой секции: его и в покое меняют на месте
              (галочка), поэтому состав не уводим в форму заявки. Правка —
              явным режимом, чтобы рука, привыкшая отмечать, не промахнулась
              по «удалить». */}
          {(hasChecklist || checklistEdit) && (
            <Section>
              <Eyebrow
                id="ticket-checklist"
                count={ticket.checklist?.length || undefined}
                action={
                  canEditChecklist && (
                    <SectionEditButton
                      label="Чек-лист"
                      editing={checklistEdit}
                      onToggle={() => setChecklistEdit((prev) => !prev)}
                    />
                  )
                }
              >
                Чек-лист
              </Eyebrow>
              <Panel>
                {/* Откуда список: в 96 % случаев это регламент, и пункты для
                  будущих заявок правятся там, а не здесь */}
                {(ticket.routineTask?.title ||
                  (canEditChecklist && templates)) && (
                  <p className="mt-0 mb-3 flex items-center gap-1.5 border-b border-border-soft pb-2.5 text-xs text-muted-foreground">
                    <RiRepeat2Line size={14} className="text-faint" />
                    {ticket.routineTask?.title ? (
                      <>
                        Из регламента{" "}
                        <Link
                          to={`/routine-tasks/${ticket.routineTask._id}`}
                          state={fromState}
                          className="text-accent-text no-underline hover:underline"
                        >
                          «{ticket.routineTask.title}»
                        </Link>
                      </>
                    ) : (
                      "Чек-лист заявки"
                    )}
                    {/* Кнопка появляется, только когда есть из чего выбирать;
                      у регламентной заявки список — часть определения задания,
                      и шаблоны его не подменяют (сервер отдаёт пустой matched) */}
                    {!ticket.routineTask && canEditChecklist && (
                      <TemplatePicker
                        templates={templates}
                        hasChecks={checklistHasChecks}
                        onApply={applyTemplate}
                        onClear={() => applyTemplate({ items: [], title: "" })}
                        trigger={
                          <Button
                            variant="ghost"
                            size="xs"
                            className="ms-auto text-muted-foreground"
                          >
                            Ещё чек-листы ·{" "}
                            {(templates?.matched?.length ?? 0) +
                              (templates?.others?.length ?? 0)}
                          </Button>
                        }
                      />
                    )}
                  </p>
                )}
                {checklistEdit ? (
                  <Checklist
                    key="edit"
                    mode="edit"
                    items={ticket.checklist ?? []}
                    showHeader={false}
                    framed={false}
                    onChange={saveChecklist}
                  />
                ) : ticket.checklist?.length ? (
                  <Checklist
                    key="run"
                    mode="run"
                    items={ticket.checklist}
                    showHeader={false}
                    framed={false}
                    canCheck={mine && !ticket.isArchived}
                    mandatoryGuard
                    onToggle={(item, checked) =>
                      checklistFetcher.submit(
                        {
                          intent: "updateChecklistItem",
                          itemId: item._id,
                          itemDescription: item.description,
                          itemChecked: checked,
                          ticketNum: ticket.num,
                        },
                        { method: "POST", action: `/tickets/${ticket.num}` },
                      )
                    }
                  />
                ) : null}
              </Panel>
            </Section>
          )}

          {showWorks && (
            <WorksSection
              works={works}
              ticket={ticket}
              canAddWork={
                canPerform && !["Новая", "Не в работе"].includes(ticket.state)
              }
              onOpenForm={offcanvas.setShow}
            />
          )}

          {showEnvironment && (
            <Section className={environmentEmpty ? "hidden" : undefined}>
              <Eyebrow id="ticket-environment">Окружение</Eyebrow>
              <Environment
                userId={ticket.applicant?._id}
                deviceId={ticket.relatedClientDeviceId}
                onEmptyChange={setEnvironmentEmpty}
                from={`Заявка №${ticket.num}`}
              />
            </Section>
          )}

          {showKnowledge && <KnowledgeSection ticket={ticket} />}
        </div>

        <div className="sticky top-20 hidden w-96 flex-none xl:block">
          <Chronicle
            ticket={ticket}
            events={events}
            canComment={!ticket.isArchived && !!can({ ticket: ["perform"] })}
          />
        </div>
      </div>

      {/* На узких экранах хроника идёт последней секцией */}
      <div className="mt-5 xl:hidden">
        <Chronicle
          ticket={ticket}
          events={events}
          canComment={!ticket.isArchived && !!can({ ticket: ["perform"] })}
        />
      </div>

      <ActionDialog
        action={dialog}
        ticket={ticket}
        works={works}
        responsibles={responsiblesData}
        onClose={() => setDialog(null)}
        onFixWorks={() => pickAction("addWork")}
      />

      <DeleteDialog
        item={{ _id: ticket._id, title: `Заявка № ${ticket.num}` }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />

      <CompanyLogsOffcanvas
        show={logsQuery !== null}
        onHide={() => setLogsQuery(null)}
        companyId={company?._id}
        company={company}
        can={can}
        initialSearchQuery={logsQuery ?? ""}
      />

      <FormSheet
        open={offcanvas.isActive}
        size="lg"
        onOpenChange={(open) => {
          if (!open) {
            navigate(-1);
            offcanvas.setClose();
          }
        }}
      >
        <Outlet />
      </FormSheet>
    </div>
  );
};

export default ViewTicket;

export async function loader({ params }) {
  document.title = `Заявка № ${params.ticketNum}`;

  const { userId } = getLocalStorageData();
  // Заголовков не осталось: сеанс едет cookie, и объект пустой лишь потому,
  // что ниже он передаётся в несколько fetch подряд.
  const headers = {};

  const ticketResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${params.ticketNum}`,
    { headers },
  );
  if (!ticketResponse.ok) throw ticketResponse;
  const ticketData = await ticketResponse.json();

  const responsiblesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/can-perform-tickets`,
    { headers },
  );
  if (!responsiblesResponse.ok) throw responsiblesResponse;

  const openedTicketsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/all-opened`,
    { headers },
  );
  if (!openedTicketsResponse.ok) throw openedTicketsResponse;
  const openedTickets = await openedTicketsResponse.json();

  const additionalDataResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/works/additional-data/${params.ticketNum}`,
    { headers },
  );
  if (!additionalDataResponse.ok) throw additionalDataResponse;
  const additionalData = await additionalDataResponse.json();

  return {
    ...additionalData,
    ticketData,
    responsiblesData: await responsiblesResponse.json(),
    // «Другие заявки этой компании» нужны формам работ: одна запись работы
    // привязывается сразу к нескольким заявкам одной компании и категории
    otherCompanyTickets: openedTickets.tickets.filter((item) => {
      const currentCompanyId = ticketData.ticket?.company?._id;
      return (
        currentCompanyId &&
        item?.company?._id?.toString() === currentCompanyId.toString() &&
        item.num !== ticketData.ticket.num &&
        item.responsibles.map((user) => user._id.toString()).includes(userId) &&
        (item.categoryId ? item.categoryId.toString() : null) ===
          ticketData.ticket.categoryId?.toString()
      );
    }),
  };
}

export { action } from "./view-actions";

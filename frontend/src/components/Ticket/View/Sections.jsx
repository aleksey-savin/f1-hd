import { useContext, useEffect, useRef, useState } from "react";

import { Link, useFetcher } from "react-router";
import DOMPurify from "dompurify";
import {
  RiBuilding2Line,
  RiCheckboxCircleLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiFileCopyLine,
  RiHistoryLine,
  RiMapPin2Line,
  RiMoreLine,
  RiPhoneLine,
  RiPriceTag3Line,
  RiTeamLine,
  RiToolsLine,
  RiUserLine,
} from "react-icons/ri";

import EntityLink from "@/components/app/EntityLink";
import UserLink from "@/components/app/UserLink";
import ApplicantPopup from "./ApplicantPopup";
import { useCrumbFrom } from "@/components/app/Crumbs";
import ClientTime from "@/components/app/ClientTime";
import { copyText } from "@/components/app/PropRow";
import {
  Eyebrow,
  Panel,
  Section,
  SectionEditLink,
  SubLabel,
} from "@/components/app/Panel";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { AuthedUserContext } from "../../../store/authed-user-context";
import AiMark from "./AiMark";
import TicketTerms, {
  appendAiMark,
  highlightTerms,
  inTextTerms,
} from "./TicketTerms";
import useInitialPrefsStore from "../../../store/prefs";
import { formatDate } from "../../../util/format-date";
import { formatMailSender, parseMailSender } from "../../../util/mail-sender";
import { getCompanyAddresses } from "../../Company/company-links";
import TaxiButton, { cardTaxiClass } from "../../Company/TaxiButton";
import WorkStatusText from "../../Company/WorkStatusText";
import { formatMoney } from "../../Report/work-format";
import { cn } from "@/lib/utils";
import { useCan } from "@/store/authed-user";
import { AI_ACCESS } from "./ai-access";

// Секции карточки заявки. Все они ТОЛЬКО показывают: правка — в форме заявки.
// Вход в неё — карандаш `app/SectionEditLink` в метке секции (проявляется по
// наведению на секцию — её оборачивает `app/Section`), а залитая «Изменить» на
// карточке одна, в шапке. Примитивы метки и панели — из каталога
// `app/Panel`, своих не заводим.

/**
 * Пустая секция — одна строка, а не плакат: пустых секций на карточке заявки
 * обычно несколько сразу (чек-лист, работы), и каждая, занимая
 * четверть экрана иллюстрацией, отодвигает вниз то, ради чего заявку открыли.
 *
 * Кнопок внутри нет: действие секции живёт в её метке, где бы оно ни
 * понадобилось — и когда секция пустая, и когда полная. Иначе «Добавить
 * чек-лист» стоит внутри панели, а «Добавить работу» — над ней, и глазу негде
 * закрепиться.
 */
export const EmptySection = ({ icon: Icon, hint }) => (
  <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
    <Icon size={16} aria-hidden className="flex-none text-faint" />
    <span className="min-w-0 flex-1">{hint}</span>
  </div>
);

/* ─────────────── Описание ─────────────── */

/**
 * Описание вместе с вложениями: файлы — часть описания проблемы, а не второй
 * предмет карточки (разбор — в шапке `View/AttachmentStrip`). Метка остаётся
 * «Описание», счётчик файлов живёт в самой ленте: в метке он считал бы текст
 * вместе с файлами.
 */
export const DescriptionSection = ({
  ticket,
  attachments,
  uploadAction,
  canEdit,
  onEdit,
}) => {
  const [showOriginal, setShowOriginal] = useState(false);
  const [openTerm, setOpenTerm] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { isEndUser } = useContext(AuthedUserContext);
  const can = useCan();
  const { modules, ai } = useInitialPrefsStore();
  const clean = (html) => ({ __html: DOMPurify.sanitize(html) });

  const canUseAi = !!can(AI_ACCESS);
  // «Понятия в заявке» — функция ИИ по кнопке исполнителя: сервер спрашивает те
  // же права и тот же переключатель (Настройки → ИИ → «Функции»)
  const showTerms = canUseAi && !!ai?.features?.terms;
  // Замечание по метке ✦ — своя функция; сама метка — факт происхождения поля
  // и видна сотрудникам и при выключенном ИИ
  const canFeedback = canUseAi && !!ai?.features?.feedback;
  const terms = showTerms ? inTextTerms(ticket) : [];
  const canSaveNote =
    !!modules?.knowledgeBase?.isActive && !!can({ knowledge: ["manage"] });

  // Понятия подчёркиваем строкой в уже очищенном html, поэтому своих React-узлов
  // там нет: клик ловим одним обработчиком на всей панели и находим понятие по
  // номеру из data-атрибута
  const description = DOMPurify.sanitize(ticket.description || "");
  // Метка ИИ — только там, где он вписал данные вместо человека: итог звонка
  // стал описанием заявки, и ошибка в нём уезжает в уведомление и в отчёт
  const marked = !isEndUser && ticket.aiSpeech?.status === "processed";
  const withTerms = showTerms ? highlightTerms(description, terms) : description;
  const html = marked
    ? appendAiMark(withTerms, "Описание собрано ИИ из записи звонка", {
        interactive: canFeedback,
      })
    : withTerms;
  const clickable = showTerms || (marked && canFeedback);

  // Клик по подчёркнутому понятию или по метке: свои React-узлы в готовом html
  // не живут, поэтому обработчик один на всю панель
  const pickFromText = (event) => {
    // Клик может прийти по <path> внутри иконки — ищем метку вверх по дереву
    if (event.target?.closest?.("[data-ai-mark]")) {
      setFeedbackOpen(true);
      return;
    }
    const hit = event.target?.closest?.("[data-term]");
    if (!hit) return;
    const term = terms[Number(hit.dataset.term)];
    setOpenTerm((current) => (current === term ? null : term));
  };

  return (
    <Section>
      <Eyebrow
        id="ticket-description"
        action={
          <>
            {ticket.htmlDescription && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setShowOriginal(true)}
              >
                Оригинал письма
              </Button>
            )}
            {uploadAction}
            {canEdit && (
              // Тема и описание правятся в форме заявки — карандаш открывает
              // её сразу на этой секции
              <SectionEditLink
                to="update#description"
                label="Описание"
                onClick={onEdit}
              />
            )}
          </>
        }
      >
        Описание
      </Eyebrow>
      <Panel>
        {ticket.description ? (
          // Описание бывает огромным (логи бэкапа на 33 000 знаков) —
          // ограничиваем высоту и скроллим внутри, чтобы не растягивать колонку.
          // Кегль крупнее остальных секций: это единственный текст на карточке,
          // который читают целиком, а не сканируют.
          <div
            className="md-doc max-h-96 overflow-auto text-base leading-relaxed break-words"
            onClick={clickable ? pickFromText : undefined}
            onKeyDown={
              clickable
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ")
                      pickFromText(event);
                  }
                : undefined
            }
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p className="my-0 text-sm text-muted-foreground">Нет описания</p>
        )}
        {/* Сама метка дописана в конец текста выше — здесь только форма
            замечания, которую она открывает */}
        {canFeedback && marked && (
          <AiMark
            ticketId={ticket._id}
            target="description"
            hint="Описание собрано ИИ из записи звонка"
            title="Что не так в описании?"
            scope="итогов звонка"
            open={feedbackOpen}
            onOpenChange={setFeedbackOpen}
          />
        )}

        {attachments}

        {showTerms && (
          <TicketTerms
            openTerm={openTerm}
            onOpenTerm={setOpenTerm}
            canSaveNote={canSaveNote}
          />
        )}
      </Panel>

      {ticket.htmlDescription && (
        <Dialog open={showOriginal} onOpenChange={setShowOriginal}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Оригинал письма</DialogTitle>
            </DialogHeader>
            <div
              // md-doc — не только типографика: там же ужимание картинок из
              // чужого html (index.css), иначе письмо с широким скриншотом
              // распирает диалог
              className="md-doc max-h-[70dvh] overflow-y-auto text-sm"
              dangerouslySetInnerHTML={clean(ticket.htmlDescription)}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowOriginal(false)}>
                Закрыть
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Section>
  );
};

/* ─────────────── Заявка (свойства) ─────────────── */

const PropRow = ({ icon, label, children, action }) => (
  <div className="flex items-start gap-3 border-t border-border-soft py-2.5 first:border-t-0 first:pt-0">
    <span className="grid size-8 flex-none place-items-center rounded-lg bg-accent text-muted-foreground">
      {icon}
    </span>
    <span className="w-28 flex-none pt-1.5 text-sm text-muted-foreground">
      {label}
    </span>
    <span className="min-w-0 flex-1 pt-1 text-sm leading-snug">
      {children || <span className="text-faint">—</span>}
    </span>
    {/* Флекс, а не голый span: кнопка такси объявлена `grid` (блочный бокс), и
        рядом с ней копирование уезжало на строку ниже */}
    {action && (
      <span className="flex flex-none items-center gap-0.5">{action}</span>
    )}
  </div>
);

const Pill = ({ className, children }) => (
  <span
    className={cn(
      "me-1.5 mb-1.5 inline-flex items-center rounded-full border border-border-soft bg-accent px-2.5 py-0.5 text-sm font-medium",
      className,
    )}
  >
    {children}
  </span>
);

/**
 * Куда ехать к инициатору: адрес его подразделения (ближайшего с адресом),
 * иначе — компании; каскад и список адресов компании считает бэкенд
 * (`services/clientAddress` → `ticket.clientAddress`, `company.addresses`).
 * Такси стоит здесь, у адреса, а не у компании: у многоадресной компании оно
 * везёт именно сюда, остальные адреса — в меню кнопки (`Company/TaxiButton`).
 * Источник адреса подписан, только когда есть из чего выбирать.
 */
const ClientAddressRow = ({ ticket, company, isEndUser }) => {
  const resolved = ticket.clientAddress;
  const address = resolved?.address || null;
  const severalAddresses = getCompanyAddresses(company).length > 1;
  const fromSubdivision = resolved?.source === "subdivision";
  const sourceText = !severalAddresses
    ? null
    : fromSubdivision
      ? resolved.sourceName
      : resolved?.source === "company"
        ? "основной адрес"
        : null;
  // Заявителю ни такси, ни копирования: такси везёт К НЕМУ, а адрес свой он и
  // так знает. Это инструменты выезда, а не сведения о заявке.
  const tools = !isEndUser;
  const showTaxi = tools && Boolean(ticket.company?._id);

  return (
    <PropRow
      icon={<RiMapPin2Line size={16} />}
      label="Адрес"
      action={
        (showTaxi || (tools && address)) && (
          <>
            {showTaxi && (
              <TaxiButton
                company={company}
                defaultKey={resolved?.key}
                defaultReason={
                  fromSubdivision ? "подразделение инициатора" : null
                }
                className={cn(cardTaxiClass, "text-muted-foreground")}
              />
            )}
            {tools && address && (
              <Button
                variant="ghost"
                size="icon-xs"
                title="Скопировать"
                aria-label="Скопировать адрес"
                onClick={() => copyText(address, "Адрес")}
              >
                <RiFileCopyLine />
              </Button>
            )}
          </>
        )
      }
    >
      {address && (
        <>
          {resolved.linkToMap ? (
            <a
              href={resolved.linkToMap}
              target="_blank"
              rel="noreferrer"
              title="Открыть на карте"
              className="text-accent-text no-underline hover:underline"
            >
              {address}
            </a>
          ) : (
            address
          )}
          {sourceText && (
            <span
              className="text-faint"
              title={
                fromSubdivision
                  ? `Адрес подразделения «${resolved.sourceName}»`
                  : undefined
              }
            >
              {" · "}
              {sourceText}
            </span>
          )}
        </>
      )}
    </PropRow>
  );
};

export const FactsSection = ({
  ticket,
  company,
  canEdit,
  onShowLogs,
  onEdit,
}) => {
  const { isEndUser } = useContext(AuthedUserContext);
  const can = useCan();
  const applicant = ticket.applicant;
  // Заявка из письма: адрес отправителя виден всегда — почта неизвестного
  // клиента без подписи иначе никак не называет, кто написал (инициатором
  // тогда стоит служебная учётка из настроек). У служебной учётки рядом с
  // адресом и имя из заголовка From, у опознанного человека имя уже есть.
  // Только сотрудникам: отправителем может оказаться сотрудник, а его контакты
  // клиенту не показываются нигде
  const mailSender =
    !isEndUser && ticket.source === "Почта" && applicant
      ? applicant.isServiceAccount
        ? formatMailSender(ticket.realSender)
        : parseMailSender(ticket.realSender)?.address
      : null;
  // Своя компания и свой адрес заявителю ничего не сообщают: он их знает. А
  // инициатор осмыслен, только когда им бывает НЕ он сам, — то есть у того, кто
  // заводит заявки за других (тогда инициатор — не он и в своей заявке) ИЛИ
  // видит заявки всей компании (тогда инициатор — коллега). Права достаточно
  // одного: у обоих есть заявки в списке, где заявитель — не сам зритель.
  const showCompanyAndAddress = !isEndUser;
  const showApplicant =
    !isEndUser ||
    !!can({
      ticket: {
        actions: ["createForOthers", "readCompanies"],
        connector: "OR",
      },
    });
  // Как заявка назовётся в крошке компании или человека, куда ведут ссылки ниже
  const from = `Заявка ${ticket.num}`;
  const fromState = useCrumbFrom(from);
  const computer = applicant?.computer;

  return (
    <Section>
      <Eyebrow
        id="ticket-facts"
        action={
          canEdit && (
            // Ключ секции формы = якорь: форма откроется прокрученной сюда
            <SectionEditLink
              to="update#details"
              label="Детали"
              onClick={onEdit}
            />
          )
        }
      >
        Детали
      </Eyebrow>
      <Panel>
        {showCompanyAndAddress && (
          <PropRow
            icon={<RiBuilding2Line size={16} />}
            label="Компания"
            action={
              onShowLogs && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Лог активности компании"
                  onClick={() => onShowLogs()}
                >
                  <RiHistoryLine />
                </Button>
              )
            }
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* Имя — ссылка на карточку: раньше из заявки нельзя было попасть ни
                к клиенту, ни к людям, и путь лежал через поиск в справочнике */}
              {ticket.company?._id ? (
                <EntityLink from={from} to={`/companies/${ticket.company._id}`}>
                  {ticket.company.alias}
                </EntityLink>
              ) : (
                (ticket.company?.alias ?? "—")
              )}
              <ClientTime clientTimezone={ticket.clientTimezone} />
              <WorkStatusText
                workSchedule={company?.workSchedule}
                timezone={ticket.clientTimezone?.timezone}
              />
            </span>
          </PropRow>
        )}

        {showApplicant && (
          <PropRow
            icon={<RiUserLine size={16} />}
            label="Инициатор"
            action={
              <>
                {/* Заявителю кнопки нет: инициатор — он сам */}
                {!isEndUser && applicant?.phone && (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-xs"
                    title={`Позвонить: ${applicant.phone}`}
                    aria-label="Позвонить инициатору"
                  >
                    <a href={`tel:${applicant.phone}`}>
                      <RiPhoneLine />
                    </a>
                  </Button>
                )}
                {onShowLogs &&
                  can({ company: ["readLogs"] }) &&
                  applicant?.activeDirectoryObjectGUID && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Лог активности пользователя"
                      onClick={() =>
                        onShowLogs(
                          `${applicant.firstName} ${applicant.lastName}`,
                        )
                      }
                    >
                      <RiHistoryLine />
                    </Button>
                  )}
              </>
            }
          >
            {applicant?._id && !applicant.isServiceAccount ? (
              /* Клик по имени — попап с контактами, а не переход: на
                 инициатора смотрят, чтобы позвонить, не теряя заявку. В
                 профиль ведёт кнопка внутри попапа (по праву) */
              <ApplicantPopup
                ticket={ticket}
                applicant={applicant}
                from={from}
              />
            ) : applicant ? (
              `${applicant.lastName ?? ""} ${applicant.firstName ?? ""}`.trim()
            ) : (
              formatMailSender(ticket.realSender) ?? ticket.realSender
            )}
            {/* Служебная учётка (регламент, мониторинг, телефония): контактов
                у неё нет, поэтому имя не кликается, а приписка объясняет,
                почему инициатор не человек */}
            {applicant?.isServiceAccount ? (
              <span className="text-muted-foreground"> · служебная учётка</span>
            ) : (
              applicant?.position && (
                <span className="text-muted-foreground">
                  {" · "}
                  {applicant.position}
                </span>
              )
            )}
            {mailSender && (
              <span className="text-muted-foreground">
                {" · письмо от "}
                {mailSender}
              </span>
            )}
          </PropRow>
        )}

        {showCompanyAndAddress && (
          <ClientAddressRow
            ticket={ticket}
            company={company}
            isEndUser={isEndUser}
          />
        )}

        <PropRow icon={<RiTeamLine size={16} />} label="Ответственные">
          {ticket.responsibles?.length
            ? ticket.responsibles.map((user) => (
                /* Подсветка по наведению — на ссылке, а не на самой пилюле:
                   без права «Видеть пользователей» UserLink оставляет один
                   текст, и пилюля не должна прикидываться кликабельной */
                <UserLink
                  key={user._id}
                  id={user._id}
                  state={fromState}
                  className="group/person no-underline"
                >
                  <Pill className="group-hover/person:border-primary group-hover/person:text-accent-text">
                    {user.lastName} {user.firstName}
                  </Pill>
                </UserLink>
              ))
            : null}
        </PropRow>

        <PropRow icon={<RiPriceTag3Line size={16} />} label="Категория">
          {ticket.category?.title}
          {/* Категорию подбирает ИИ в фоне при создании заявки — пока он думает,
              пустая строка выглядела бы как «категории нет» */}
          {!ticket.category?.title &&
            ticket.aiCategory?.status === "pending" && (
              <span className="text-muted-foreground">
                ИИ подбирает категорию…
              </span>
            )}
          {/* Подобранная категория — второе место, где ИИ заполнил поле заявки:
              ошибка в ней уводит подбор заметок и отчёты */}
          {!isEndUser && ticket.aiCategory?.status === "processed" && (
            <span className="ms-1.5">
              <AiMark
                ticketId={ticket._id}
                target="category"
                hint="Категорию подобрал ИИ"
                title="Категория подобрана неверно?"
                scope="подбора категории для этой компании"
              />
            </span>
          )}
        </PropRow>

        {computer?.name && (
          <PropRow icon={<RiComputerLine size={16} />} label="Компьютер">
            <span className="font-mono text-sm">{computer.name}</span>
            {computer.activeDirectoryLogin && (
              <span className="text-muted-foreground">
                {" ("}
                {computer.activeDirectoryLogin}
                {")"}
              </span>
            )}
            {computer.lastSeenAt && (
              <span className="block text-xs text-faint">
                вход {formatDate(computer.lastSeenAt)}
              </span>
            )}
          </PropRow>
        )}

        <PropRow icon={<RiHistoryLine size={16} />} label="Создана">
          <span className="text-muted-foreground">
            {formatDate(ticket.createdAt)}
            {ticket.source ? ` · ${ticket.source}` : ""}
          </span>
        </PropRow>
      </Panel>
    </Section>
  );
};

/* ─────────────── Работы ─────────────── */

/**
 * Строка работы. Правка и удаление — в «⋯», как в строке списка: у работы их
 * два-три, и текстовые кнопки в каждой строке съели бы место под саму работу.
 * Удаляет автор работы или администратор — то же правило, что на бэкенде
 * (`controllers/work.js`), иначе кнопка обещает больше, чем разрешено.
 *
 * Колонки выровнены по верху: описание переносится, а не режется (макет
 * «Работы в заявке: описание видно целиком»). На телефоне строка складывается:
 * «имя · вид … ⋯» первой строкой, описание — под ней во всю ширину.
 */
const WorkRow = ({ ticket, children, menu }) => (
  <div className="group flex flex-wrap items-start gap-x-3 gap-y-0.5 border-t border-border-soft py-2.5 text-sm first:border-t-0 md:flex-nowrap">
    {children}
    <span className="flex w-7 flex-none justify-end max-md:order-3">
      {!ticket.isArchived && menu}
    </span>
  </div>
);

/**
 * Кто и как: исполнитель, под ним вид работы микроподписью — колонка
 * описания остаётся только текстом. На телефоне оба в одну строку через «·».
 */
const WorkWho = ({ person, kind }) => (
  <span className="text-muted-foreground max-md:flex max-md:min-w-0 max-md:flex-1 max-md:items-baseline max-md:gap-1.5 md:w-32 md:min-w-0 md:flex-none">
    <span className="min-w-0 truncate md:block">
      {person?.lastName} {person?.firstName?.[0]}.
    </span>
    <span className="flex-none text-xs text-faint md:block">
      <span className="md:hidden">· </span>
      {kind}
    </span>
  </span>
);

/**
 * Описание работы: до четырёх строк, дальше «Показать полностью». Кнопка
 * появляется только у текста, который действительно не поместился, — замер
 * после раскладки и при смене ширины колонки (поворот телефона, шторка).
 */
const WorkDescription = ({ text }) => {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    // Раскрытый текст не меряем: без обрезки он «помещается» всегда, и кнопка
    // «Свернуть» исчезла бы
    if (open) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const measure = () =>
      setOverflows(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, open]);

  if (!text) {
    return <span className="text-faint">без описания</span>;
  }

  return (
    <>
      <p
        ref={ref}
        className={cn(
          "m-0 break-words whitespace-pre-line",
          !open && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-0.5 inline-flex cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs text-accent-text outline-none hover:underline focus-visible:underline"
        >
          {open ? "Свернуть" : "Показать полностью"}
        </button>
      )}
    </>
  );
};

/**
 * Заглушка секции говорит про **это** состояние заявки: «без работ не закрыть»
 * у новой заявки — совет не по адресу, работы к ней ещё нельзя привязать.
 *
 * Все подсказки про «указать работы» адресованы тому, кто их записывает. Кто
 * работы только видит (в том числе клиент с правом «видеть работы»), получает
 * констатацию: советовать ему завести работу незачем, ручки у него нет.
 */
const emptyWorksHint = (ticket, mayLog) => {
  if (!mayLog) return "Работы по заявке не указаны";
  if (ticket.state === "Новая")
    return "Работы можно указать после обработки заявки";
  if (ticket.state === "Не в работе")
    return "Работы можно указать, когда заявку примут в работу";
  if (ticket.isClosed || ticket.state === "Закрыта")
    return "Работы по заявке не указаны";
  return "Работ нет — без них заявку не закрыть";
};

const WorkMenu = ({ items }) => {
  if (!items.length) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Действия с работой"
          title="Действия"
          className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
        >
          <RiMoreLine />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) =>
          item.to ? (
            <DropdownMenuItem key={item.key} asChild>
              <Link to={item.to} onClick={item.onClick}>
                {item.icon} {item.label}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={item.key}
              variant={item.danger ? "destructive" : undefined}
              onSelect={item.onSelect}
            >
              {item.icon} {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const WorksSection = ({ works = [], ticket, canAddWork }) => {
  const { _id: userId } = useContext(AuthedUserContext);
  const can = useCan();
  // Доплата вне графика — её видит тот, кому открыта стоимость работ
  // (getOne → canSeeMoney).
  const showBilling = can({ work: ["readCost"] });
  const [deleting, setDeleting] = useState(null);

  const finished = works.filter((work) => work.finishedAt);
  const scheduled = works.filter(
    (work) => !work.finishedAt && work.planningToStart,
  );

  // Чужая работа открывается по праву «Изменять все работы», а не по признаку
  // администратора: право раздаётся и сервисному руководителю, и ровно его же
  // спрашивают ручки правки и удаления.
  const mayAnyWork = !!can({ work: ["manage"] });
  // Кому советовать «укажите работы» — только тому, кто их записывает
  const mayLogWork = !!can({ work: ["log"] });
  const mayManage = (work) =>
    mayAnyWork || work.createdBy?._id?.toString() === userId?.toString();
  const mayConfirm = (work) =>
    mayAnyWork || work.executor?._id?.toString() === userId?.toString();

  const editItem = (to) => ({
    key: "update",
    to,
    icon: <RiEdit2Line />,
    label: "Изменить",
  });
  const deleteItem = (work) => ({
    key: "delete",
    danger: true,
    onSelect: () => setDeleting(work),
    icon: <RiDeleteBinLine />,
    label: "Удалить",
  });

  const renderScheduled = (work) => (
    <WorkRow
      key={work._id}
      ticket={ticket}
      menu={
        <WorkMenu
          items={[
            mayConfirm(work) && {
              key: "confirm",
              to: `work/${work._id}/confirm`,
              icon: <RiCheckboxCircleLine />,
              label: "Подтвердить",
            },
            mayManage(work) && editItem(`work-scheduled/${work._id}/update`),
            mayManage(work) && deleteItem(work),
          ].filter(Boolean)}
        />
      }
    >
      <WorkWho
        person={work.executor}
        kind={work.visitRequired ? "выезд" : "удалённо"}
      />
      <span className="max-md:order-4 max-md:w-full md:min-w-0 md:flex-1">
        {formatDate(work.planningToStart)}
      </span>
    </WorkRow>
  );

  // Длительности в строке нет: рядовому она ни к чему, а ответственный видит
  // время в отчёте по работам.
  const renderFinished = (work) => (
    <WorkRow
      key={work._id}
      ticket={ticket}
      menu={
        <WorkMenu
          items={[
            mayManage(work) && editItem(`work/${work._id}/update`),
            mayManage(work) && deleteItem(work),
          ].filter(Boolean)}
        />
      }
    >
      <WorkWho
        person={work.finishedBy}
        kind={work.visitRequired ? "выезд" : "удалённо"}
      />
      <span className="max-md:order-4 max-md:w-full md:min-w-0 md:flex-1">
        <WorkDescription text={work.description} />
      </span>
      {/* В списке показываем только исключение: у работы в рамках тарифа поля
          outOfSchedule нет вовсе. Сумма — по тем же правам, что и в форме
          (её решает сервер). leading-5 — на одну линию с именем */}
      {showBilling && work.outOfSchedule && (
        <span
          className="flex-none text-xs leading-5 text-warning tabular-nums max-md:order-2"
          title="Время вне графика обслуживания"
        >
          доп. оплата
          {work.outOfSchedule.money
            ? ` ${formatMoney(work.outOfSchedule.money.cost)}`
            : ""}
        </span>
      )}
    </WorkRow>
  );

  const groups = [
    scheduled.length > 0 && {
      key: "scheduled",
      label: "Запланировано",
      rows: scheduled,
      render: renderScheduled,
    },
    finished.length > 0 && {
      key: "finished",
      label: "Выполнено",
      rows: finished,
      render: renderFinished,
    },
  ].filter(Boolean);
  const labelled = groups.length > 1;

  // «Новая работа», а не «Добавить работу»: по словарю действий «Добавить» —
  // только привязка уже существующего
  const actions = canAddWork && (
    <>
      <Button asChild variant="outline" size="xs">
        <Link to="work/add">Новая работа</Link>
      </Button>
      <Button asChild variant="outline" size="xs">
        <Link to="work/schedule">Запланировать</Link>
      </Button>
    </>
  );

  return (
    <Section>
      <Eyebrow
        id="ticket-works"
        count={works.length || undefined}
        action={actions}
      >
        Работы
      </Eyebrow>
      <Panel>
        {works.length === 0 ? (
          <EmptySection
            icon={RiToolsLine}
            hint={emptyWorksHint(ticket, mayLogWork)}
          />
        ) : (
          /* Подгруппы: «что ещё будет» и «что уже сделали» — разные вопросы,
             и одним списком ответ на каждый приходится вычитывать из хвоста
             строки. Единственная группа метки не получает: заголовок с одной
             группой не несёт информации. */
          groups.map((group, index) => (
            <div key={group.key} className={index > 0 ? "mt-4" : undefined}>
              {labelled && (
                <SubLabel count={group.rows.length}>{group.label}</SubLabel>
              )}
              <div className="-my-1">{group.rows.map(group.render)}</div>
            </div>
          ))
        )}
      </Panel>

      {/* Диалог — вне «⋯»: radix размонтирует содержимое меню при закрытии */}
      <DeleteWorkDialog
        work={deleting}
        ticketNum={ticket.num}
        onClose={() => setDeleting(null)}
      />
    </Section>
  );
};

const DeleteWorkDialog = ({ work, ticketNum, onClose }) => {
  const fetcher = useFetcher();

  return (
    <AlertDialog
      open={Boolean(work)}
      onOpenChange={(next) => !next && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить работу</AlertDialogTitle>
          <AlertDialogDescription>
            Работа исчезнет из заявки и из отчётов. Это действие нельзя
            отменить.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={fetcher.state !== "idle"}
            onClick={() => {
              fetcher.submit(
                { intent: "deleteWork", workId: work._id },
                { method: "POST", action: `/tickets/${ticketNum}` },
              );
              onClose();
            }}
          >
            <RiDeleteBinLine /> Удалить
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

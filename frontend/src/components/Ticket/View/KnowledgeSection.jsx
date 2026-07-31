import { useContext, useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router";
import { isMobile } from "react-device-detect";
import {
  RiAddLine,
  RiArrowRightSLine,
  RiBookOpenLine,
  RiExternalLinkLine,
  RiSearchLine,
} from "react-icons/ri";

import { Eyebrow, Panel, Section } from "@/components/app/Panel";
import Spinner from "@/components/app/Spinner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../../../store/authed-user-context";
import useKnowledgeNotesStore from "../../../store/lists/knowledgeNotes";
import { getLocalStorageData } from "../../../util/auth";
import { formatShortDate } from "../../../util/format-date";
import { getNoteTypeMeta } from "../../../util/knowledgeNoteTypes";
import MarkdownViewer from "../../../UI/MarkdownViewer";
import { BindingPillList } from "../../KnowledgeBase/BindingPills";
import { EmptySection } from "./Sections";

/**
 * Подсказки базы знаний в заявке.
 *
 * Секция отвечает на один вопрос: известно ли что-то про эту заявку заранее.
 * Строка говорит четыре вещи — тип (иконка), о чём (заголовок), можно ли верить
 * («не проверено»), почему попало в заявку (группа, в которой стоит).
 *
 * Значков на строках нет. Данные показали, почему: 175 заметок из 176 привязаны
 * к компании, поэтому «совпало по компании» стояло на каждой строке и не
 * различало ни одну, а привязок к людям нет ни у одной — значок «по инициатору»
 * не появлялся никогда. Совпадение по категории редкое (48 из 176) и потому
 * ценное: его называет заголовок группы. Фильтр по типу убран — 167 заметок из
 * 176 одного типа, сужать нечего.
 *
 * Читают заметку в ПРАВОЙ ШТОРКЕ: подсказка — документ, и место ей нужно
 * документа, а не полоска внутри секции. Раскрытие на месте отвергнуто на
 * живом прогоне: короткие заметки ещё влезали, а инструкция на три экрана
 * превращалась в окошко со скроллом внутри прокручиваемой страницы. Шторка
 * заодно даёт то, ради чего этот приём и существует: список остаётся виден, и
 * следующую строку можно щёлкнуть, не закрывая текущую.
 *
 * Целиком, с правкой и вложениями, заметка живёт в базе знаний — ссылка в
 * подвале шторки открывает её в новой вкладке, заявка остаётся на своей.
 */

const API = import.meta.env.VITE_API_ADDRESS;

// Сколько строк показываем свёрнутыми и сколько подсказок — без «Показать все»
const VISIBLE_LIMIT = 5;
const COLLAPSE_FROM = 6;

const includesId = (items, id) =>
  !!id && (items || []).some((item) => item?._id?.toString() === id.toString());

// Помечает заметку совпадениями по измерениям заявки и считает релевантность
const annotate = (note, companyId, categoryId, applicantId) => {
  const matchCompany = includesId(note.companies, companyId);
  const matchCategory = includesId(note.categories, categoryId);
  const matchUser = includesId(note.users, applicantId);
  return {
    ...note,
    matchCompany,
    matchCategory,
    matchUser,
    matchCount: matchCompany + matchCategory + matchUser,
  };
};

// Порядок: больше пересечений → приоритет типа (бэклог > инструкции >
// информация) → свежесть. Правило прежнее, новое — что его видно: первая
// половина стала группами.
const byRelevance = (a, b) =>
  b.matchCount - a.matchCount ||
  getNoteTypeMeta(b.type).priority - getNoteTypeMeta(a.type).priority ||
  new Date(b.updatedAt) - new Date(a.updatedAt);

// Заметка попадает в группу по самому узкому совпадению: категория точнее, чем
// «вся компания», поэтому она и открывает список
const groupKeyOf = (note) => {
  if (note.matchCategory) return "category";
  if (note.matchCompany) return "company";
  return "user";
};

const GROUP_ORDER = ["category", "company", "user"];

const NoteRow = ({ note, active, onOpen }) => {
  const typeMeta = getNoteTypeMeta(note.type);
  const TypeIcon = typeMeta.icon;
  const meta = [
    typeMeta.label,
    note.approved !== true ? "не проверено" : null,
    note.updatedAt ? formatShortDate(note.updatedAt) : null,
  ];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "tw:relative tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-start tw:gap-2.5 tw:rounded-lg tw:border-0 tw:px-2 tw:py-2 tw:text-start tw:transition-colors tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
        // Открытая подсказка остаётся отмеченной в списке: шторку не закрывают,
        // чтобы посмотреть следующую
        active ? "tw:bg-primary/10" : "tw:bg-transparent tw:hover:bg-accent",
      )}
    >
      <RiArrowRightSLine
        size={16}
        aria-hidden
        className="tw:mt-0.5 tw:flex-none tw:text-faint"
      />
      <TypeIcon
        size={17}
        aria-hidden
        title={typeMeta.label}
        className="tw:mt-0.5 tw:flex-none tw:text-faint"
      />
      <span className="tw:min-w-0 tw:flex-1">
        <span className="tw:block tw:text-[0.9375rem] tw:leading-snug tw:font-medium">
          {note.title}
        </span>
        <span className="tw:mt-0.5 tw:block tw:text-sm tw:text-muted-foreground">
          {meta[0]}
          {meta[1] && (
            <>
              {" · "}
              <span className="tw:text-warning">{meta[1]}</span>
            </>
          )}
          {meta[2] && (
            <span className="tw:tabular-nums">{` · ${meta[2]}`}</span>
          )}
        </span>
      </span>
    </button>
  );
};

/**
 * Шторка чтения: заголовок, чем заметка привязана к заявке, текст и вход в базу
 * знаний. Справа на десктопе (список остаётся виден), снизу на мобилке — там
 * правая всё равно вырождается в полный экран.
 */
const NoteSheet = ({ note, loading, onClose }) => {
  const typeMeta = note ? getNoteTypeMeta(note.type) : null;
  const TypeIcon = typeMeta?.icon;

  return (
    <Sheet
      open={Boolean(note)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          isMobile ? "tw:h-[92dvh]" : "tw:w-11/12 tw:sm:max-w-2xl",
          "tw:gap-0",
        )}
      >
        <div className="tw:px-5 tw:pt-4">
          <div className="tw:flex tw:items-center tw:gap-2 tw:pe-8 tw:text-sm tw:text-muted-foreground">
            {TypeIcon && (
              <TypeIcon size={15} aria-hidden className="tw:text-faint" />
            )}
            {typeMeta?.label}
            {note?.approved !== true && (
              <>
                <span className="tw:text-faint">·</span>
                <span className="tw:text-warning">не проверено</span>
              </>
            )}
            {note?.updatedAt && (
              <span className="tw:tabular-nums">{`· ${formatShortDate(note.updatedAt)}`}</span>
            )}
          </div>
          <SheetTitle className="tw:mt-1 tw:mb-0 tw:pe-8 tw:text-lg tw:leading-snug tw:font-semibold tw:tracking-tight tw:break-words">
            {note?.title ?? "Заметка"}
          </SheetTitle>

          {/* Пилюли привязок — каталожные: те же, что на странице заметки */}
          <div className="tw:mt-3 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <BindingPillList kind="company" items={note?.companies} />
            <BindingPillList kind="category" items={note?.categories} />
            <BindingPillList kind="user" items={note?.users} />
          </div>
        </div>

        <div className="tw:flex-1 tw:overflow-y-auto tw:px-5 tw:py-4">
          {loading ? (
            <Spinner />
          ) : (
            <div className="kb-doc md-doc tw:break-words">
              <MarkdownViewer value={note?.content || ""} />
            </div>
          )}
        </div>

        {/* Целиком — в базе знаний, в новой вкладке: заявка остаётся на своей */}
        <div className="tw:border-t tw:border-border-soft tw:px-5 tw:py-3.5">
          <Button asChild variant="outline" className="tw:w-full">
            <a
              href={`/knowledge-base/${note?._id}`}
              target="_blank"
              rel="noreferrer"
            >
              Открыть в базе знаний <RiExternalLinkLine />
            </a>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

const KnowledgeSection = ({ ticket }) => {
  const navigate = useNavigate();
  const { isAdmin, permissions } = useContext(AuthedUserContext);
  const updateFilter = useKnowledgeNotesStore((state) => state.updateFilter);

  const companyId = ticket.company?._id;
  const categoryId = ticket.category?._id;
  const applicantId = ticket.applicant?._id;

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  // Строка списка (шапка шторки готова сразу) и полная заметка с текстом
  const [openRow, setOpenRow] = useState(null);
  const [openNote, setOpenNote] = useState(null);
  const openId = openRow?._id ?? null;

  const canManage = isAdmin || permissions?.canManageKnowledgeBase;

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("company", companyId);
    if (categoryId) params.set("category", categoryId);
    if (applicantId) params.set("user", applicantId);

    if ([...params].length === 0) {
      setNotes([]);
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    const { token } = getLocalStorageData();
    fetch(`${API}/api/knowledge-notes/related?${params}`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!active) return;
        setNotes(
          (Array.isArray(data) ? data : [])
            .map((note) => annotate(note, companyId, categoryId, applicantId))
            .sort(byRelevance),
        );
      })
      .catch(() => active && setNotes([]))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [companyId, categoryId, applicantId]);

  // Тело заметки приходит отдельным запросом: список отдаётся без содержимого.
  // Шапка шторки при этом уже заполнена — из строки, по которой щёлкнули.
  const open = (note) => {
    setOpenRow(note);
    setOpenNote(null);
    const { token } = getLocalStorageData();
    fetch(`${API}/api/knowledge-notes/${note._id}`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => setOpenNote(data))
      .catch(() => setOpenNote({ ...note, content: "" }));
  };

  // Компания и категория заявки уезжают в фасеты раздела: форма новой заметки
  // наследует привязки из них (NoteView, ветка isNew), а список открывается
  // сразу по этой компании
  const withTicketContext = (to) => {
    updateFilter({
      companies: ticket.company?._id ? [ticket.company] : [],
      categories: ticket.category?._id ? [ticket.category] : [],
      users: [],
    });
    navigate(to);
  };

  // Свёрнутый список всё равно показывает открытую подсказку: она отмечена в
  // списке, пока шторка не закрыта
  const visible = useMemo(() => {
    if (showAll || notes.length < COLLAPSE_FROM) return notes;
    const head = notes.slice(0, VISIBLE_LIMIT);
    const opened = notes.find((note) => note._id === openId);
    return opened && !head.includes(opened) ? [...head, opened] : head;
  }, [notes, showAll, openId]);

  const groups = useMemo(() => {
    const buckets = new Map();
    for (const note of visible) {
      const key = groupKeyOf(note);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(note);
    }
    return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({
      key,
      notes: buckets.get(key),
    }));
  }, [visible]);

  const groupLabel = (key) => {
    if (key === "category")
      return `По категории «${ticket.category?.title ?? "—"}»`;
    if (key === "company")
      return `По компании «${ticket.company?.alias ?? "—"}»`;
    return "Про инициатора";
  };

  const newNote = canManage && (
    <Button
      variant="outline"
      size="xs"
      onClick={() => withTicketContext("/knowledge-base/add")}
    >
      <RiAddLine /> Новая заметка
    </Button>
  );

  return (
    <Section>
      <Eyebrow
        id="ticket-knowledge"
        count={notes.length || undefined}
        action={
          <>
            {newNote}
            {notes.length > 0 && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => withTicketContext("/knowledge-base")}
              >
                <RiSearchLine /> Искать в базе
              </Button>
            )}
          </>
        }
      >
        База знаний
      </Eyebrow>
      <Panel>
        {loading && <Spinner />}

        {!loading && notes.length === 0 && (
          <EmptySection
            icon={RiBookOpenLine}
            hint="Подсказок нет — ни по компании, ни по категории"
          />
        )}

        {!loading &&
          groups.map((group) => (
            <div key={group.key}>
              {/* Подзаголовок — только когда групп больше одной: у заявки с
                  одной компанией он ничего не добавил бы */}
              {groups.length > 1 && (
                <div className="tw:px-2 tw:pt-3 tw:pb-1 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase tw:first:pt-0">
                  {groupLabel(group.key)}
                </div>
              )}
              {group.notes.map((note) => (
                <NoteRow
                  key={note._id}
                  note={note}
                  active={openId === note._id}
                  onOpen={() => open(note)}
                />
              ))}
            </div>
          ))}

        {!loading && !showAll && notes.length >= COLLAPSE_FROM && (
          <Button
            variant="ghost"
            size="xs"
            className="tw:mt-1.5"
            onClick={() => setShowAll(true)}
          >
            Показать все {notes.length}
          </Button>
        )}
      </Panel>

      <NoteSheet
        note={openRow && { ...openRow, ...(openNote ?? {}) }}
        loading={!openNote}
        onClose={() => {
          setOpenRow(null);
          setOpenNote(null);
        }}
      />
    </Section>
  );
};

export default KnowledgeSection;

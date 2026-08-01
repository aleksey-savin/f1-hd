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
        "relative flex w-full cursor-pointer appearance-none items-start gap-2.5 rounded-lg border-0 px-2 py-2 text-start transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
        // Открытая подсказка остаётся отмеченной в списке: шторку не закрывают,
        // чтобы посмотреть следующую
        active ? "bg-primary/10" : "bg-transparent hover:bg-accent",
      )}
    >
      <RiArrowRightSLine
        size={16}
        aria-hidden
        className="mt-0.5 flex-none text-faint"
      />
      <TypeIcon
        size={17}
        aria-hidden
        title={typeMeta.label}
        className="mt-0.5 flex-none text-faint"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] leading-snug font-medium">
          {note.title}
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">
          {meta[0]}
          {meta[1] && (
            <>
              {" · "}
              <span className="text-warning">{meta[1]}</span>
            </>
          )}
          {meta[2] && <span className="tabular-nums">{` · ${meta[2]}`}</span>}
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
        className={cn(isMobile ? "h-[92dvh]" : "w-11/12 sm:max-w-2xl", "gap-0")}
      >
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2 pe-8 text-sm text-muted-foreground">
            {TypeIcon && (
              <TypeIcon size={15} aria-hidden className="text-faint" />
            )}
            {typeMeta?.label}
            {note?.approved !== true && (
              <>
                <span className="text-faint">·</span>
                <span className="text-warning">не проверено</span>
              </>
            )}
            {note?.updatedAt && (
              <span className="tabular-nums">{`· ${formatShortDate(note.updatedAt)}`}</span>
            )}
          </div>
          <SheetTitle className="mt-1 mb-0 pe-8 text-lg leading-snug font-semibold tracking-tight break-words">
            {note?.title ?? "Заметка"}
          </SheetTitle>

          {/* Пилюли привязок — каталожные: те же, что на странице заметки */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <BindingPillList kind="company" items={note?.companies} />
            <BindingPillList kind="category" items={note?.categories} />
            <BindingPillList kind="user" items={note?.users} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <Spinner />
          ) : (
            <div className="kb-doc md-doc break-words">
              <MarkdownViewer value={note?.content || ""} />
            </div>
          )}
        </div>

        {/* Целиком — в базе знаний, в новой вкладке: заявка остаётся на своей */}
        <div className="border-t border-border-soft px-5 py-3.5">
          <Button asChild variant="outline" className="w-full">
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
                <div className="px-2 pt-3 pb-1 text-xs font-bold tracking-wider text-faint uppercase first:pt-0">
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
            className="mt-1.5"
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

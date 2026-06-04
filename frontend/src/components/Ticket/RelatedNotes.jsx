import { useEffect, useState } from "react";
import { Link } from "react-router";

import Offcanvas from "react-bootstrap/Offcanvas";
import Badge from "react-bootstrap/Badge";
import ListGroup from "react-bootstrap/ListGroup";
import Spinner from "react-bootstrap/Spinner";
import Form from "react-bootstrap/Form";
import Stack from "react-bootstrap/Stack";
import Alert from "react-bootstrap/Alert";

import {
  RiBuilding2Line,
  RiPriceTag3Line,
  RiAccountBoxLine,
  RiExternalLinkLine,
} from "react-icons/ri";

import MarkdownViewer from "../../UI/MarkdownViewer";
import { getLocalStorageData } from "../../util/auth";
import { NOTE_TYPES, getNoteTypeMeta } from "../../util/knowledgeNoteTypes";

import "../../UI/knowledgeBase.css";

const API = import.meta.env.VITE_API_ADDRESS;

const defaultEnabledTypes = () =>
  Object.fromEntries(NOTE_TYPES.map((type) => [type.value, true]));

const includesId = (items, id) =>
  !!id && (items || []).some((item) => item?._id?.toString() === id.toString());

// Помечает заметку совпадениями по измерениям заявки (компания/категория/инициатор)
// и считает релевантность для сортировки.
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

// Сортировка по релевантности: больше пересечений → приоритет типа → свежесть.
const byRelevance = (a, b) =>
  b.matchCount - a.matchCount ||
  getNoteTypeMeta(b.type).priority - getNoteTypeMeta(a.type).priority ||
  new Date(b.updatedAt) - new Date(a.updatedAt);

// Заметки базы знаний, связанные с контекстом заявки. Список с фильтром по типу
// и просмотром заметки в Offcanvas (закрытие возвращает к заявке).
const RelatedNotes = ({
  companyId,
  categoryId,
  applicantId,
  onCountChange,
}) => {
  const { token } = getLocalStorageData();

  const [notes, setNotes] = useState([]);
  const [enabledTypes, setEnabledTypes] = useState(defaultEnabledTypes());
  const [show, setShow] = useState(false);
  const [activeNote, setActiveNote] = useState(null);
  const [noteLoading, setNoteLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("company", companyId);
    if (categoryId) params.set("category", categoryId);
    if (applicantId) params.set("user", applicantId);

    if ([...params].length === 0) {
      setNotes([]);
      onCountChange?.(0);
      return;
    }

    let active = true;
    (async () => {
      try {
        const response = await fetch(
          `${API}/api/knowledge-notes/related?${params.toString()}`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) {
          throw response;
        }
        const data = await response.json();
        if (!active) return;
        const ranked = (Array.isArray(data) ? data : [])
          .map((note) => annotate(note, companyId, categoryId, applicantId))
          .sort(byRelevance);
        setNotes(ranked);
        onCountChange?.(ranked.length);
      } catch (error) {
        console.log(error);
        if (active) {
          setNotes([]);
          onCountChange?.(0);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [companyId, categoryId, applicantId]);

  const toggleType = (value) =>
    setEnabledTypes((prev) => ({ ...prev, [value]: !prev[value] }));

  const visibleNotes = notes.filter(
    (note) => enabledTypes[note.type || "info"],
  );

  const openNote = async (id) => {
    setShow(true);
    setActiveNote(null);
    setNoteLoading(true);
    try {
      const response = await fetch(`${API}/api/knowledge-notes/${id}`, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) {
        throw response;
      }
      setActiveNote(await response.json());
    } catch (error) {
      console.log(error);
    } finally {
      setNoteLoading(false);
    }
  };

  return (
    <>
      {/* Фильтр по типу заметки — сужает список; по умолчанию все включены */}
      <Alert variant="light" className="mb-3">
        <Stack direction="horizontal" gap={3} className="flex-wrap">
          {NOTE_TYPES.map((type) => (
            <Form.Check
              key={type.value}
              type="switch"
              id={`related-note-type-${type.value}`}
              label={<Badge bg={type.badge}>{type.label}</Badge>}
              checked={enabledTypes[type.value] ?? true}
              onChange={() => toggleType(type.value)}
            />
          ))}
        </Stack>
      </Alert>

      {notes.length === 0 ? (
        <p className="text-secondary mb-0">Нет связанных заметок</p>
      ) : visibleNotes.length === 0 ? (
        <p className="text-secondary mb-0">Нет заметок выбранных типов</p>
      ) : (
        <ListGroup variant="flush">
          {visibleNotes.map((note) => {
            const typeMeta = getNoteTypeMeta(note.type);
            return (
              <ListGroup.Item
                key={note._id}
                action
                onClick={() => openNote(note._id)}
                className="d-flex flex-wrap align-items-center gap-2"
              >
                <Badge bg={typeMeta.badge}>{typeMeta.label}</Badge>
                <span className="flex-grow-1">{note.title}</span>
                {note.matchCompany && (
                  <Badge bg="secondary" title="Совпадение по компании">
                    <RiBuilding2Line />
                  </Badge>
                )}
                {note.matchCategory && (
                  <Badge bg="secondary" title="Совпадение по категории">
                    <RiPriceTag3Line />
                  </Badge>
                )}
                {note.matchUser && (
                  <Badge bg="secondary" title="Совпадение по инициатору">
                    <RiAccountBoxLine />
                  </Badge>
                )}
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      )}

      <Offcanvas
        show={show}
        onHide={() => setShow(false)}
        placement="end"
        keyboard
        style={{ width: "min(680px, 92vw)" }}
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>{activeNote?.title || "Заметка"}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {noteLoading && <Spinner animation="border" size="sm" />}
          {activeNote && (
            <>
              <div className="d-flex flex-wrap gap-1 align-items-center mb-3">
                <Badge bg={getNoteTypeMeta(activeNote.type).badge}>
                  {getNoteTypeMeta(activeNote.type).label}
                </Badge>
                {(activeNote.categories || []).map((category) => (
                  <Badge key={category._id} bg="info">
                    <RiPriceTag3Line /> {category.title}
                  </Badge>
                ))}
                {(activeNote.companies || []).map((company) => (
                  <Badge key={company._id} bg="secondary">
                    <RiBuilding2Line /> {company.alias}
                  </Badge>
                ))}
                {(activeNote.users || []).map((user) => (
                  <Badge key={user._id} className="kb-user-badge">
                    <RiAccountBoxLine /> {user.lastName} {user.firstName}
                  </Badge>
                ))}
              </div>

              <MarkdownViewer value={activeNote.content || ""} />

              <div className="mt-3">
                <Link
                  to={`/knowledge-base/${activeNote._id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="d-inline-flex align-items-center gap-1"
                >
                  <RiExternalLinkLine /> Открыть в базе знаний
                </Link>
              </div>
            </>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export default RelatedNotes;

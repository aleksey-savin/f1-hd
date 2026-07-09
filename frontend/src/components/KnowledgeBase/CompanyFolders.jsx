import { useEffect, useMemo } from "react";

import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ListGroup from "react-bootstrap/ListGroup";

import { RiArrowRightSLine, RiArrowLeftLine } from "react-icons/ri";

import AlertMessage from "../../UI/AlertMessage";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import { groupNotesByCompany } from "../../util/knowledgeNoteGrouping";

import NoteList from "./NoteList";

import "../../UI/knowledgeBase.css";

// Мобильная навигация по базе знаний: сначала компании, потом заметки компании.
// На узком экране раскрытое дерево бессмысленно — одна компания уже не влезает,
// а «Студия · 21» влезает вся. Поиск и очереди модерации выпрыгивают из
// drill-down в плоский список: там компания не является осью навигации.
const CompanyFolders = () => {
  const filteredList = useKnowledgeNotesStore((state) => state.filteredList);
  const openCompany = useKnowledgeNotesStore((state) => state.openCompany);
  const setOpenCompany = useKnowledgeNotesStore((state) => state.setOpenCompany);

  const groups = useMemo(
    () => groupNotesByCompany(filteredList),
    [filteredList],
  );

  const active = groups.find((group) => group.key === openCompany);

  // Компания исчезла из выдачи (сменили фильтр, сбросили поиск) — возвращаемся
  // к списку компаний, а не показываем пустоту.
  useEffect(() => {
    if (openCompany && !active) {
      setOpenCompany(null);
    }
  }, [openCompany, active, setOpenCompany]);

  if (openCompany && !active) {
    return null;
  }

  if (active) {
    return (
      <>
        <div className="d-flex align-items-center gap-2 mb-2">
          <Button
            variant="link"
            className="px-0"
            onClick={() => setOpenCompany(null)}
          >
            <RiArrowLeftLine /> Все компании
          </Button>
          <span className="ms-auto text-body-secondary small">
            {active.title} · {active.notes.length}
          </span>
        </div>
        {/* Компания уже в шапке — не повторяем её на каждой строке */}
        <NoteList notes={active.notes} flat showCompanies={false} />
      </>
    );
  }

  if (groups.length === 0) {
    return <AlertMessage variant="light" message="Заметок пока нет" />;
  }

  return (
    <ListGroup variant="flush">
      {groups.map((group) => (
        <ListGroup.Item
          key={group.key}
          action
          onClick={() => setOpenCompany(group.key)}
          className="d-flex align-items-center gap-2"
        >
          <span className="flex-grow-1 text-truncate">{group.title}</span>
          <Badge bg="secondary">{group.notes.length}</Badge>
          <RiArrowRightSLine
            className="text-body-secondary"
            aria-hidden="true"
          />
        </ListGroup.Item>
      ))}
    </ListGroup>
  );
};

export default CompanyFolders;

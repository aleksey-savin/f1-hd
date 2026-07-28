import { useEffect, useMemo } from "react";

import { RiArrowRightSLine, RiArrowLeftLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";

import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import { groupNotesByCompany } from "../../util/knowledgeNoteGrouping";
import { plural } from "../../util/plural";

import NoteList from "./NoteList";

// Мобильная навигация по базе знаний: сначала компании, потом заметки компании.
// На узком экране раскрытое дерево бессмысленно — одна компания уже не влезает,
// а «Гидромаш · 21» влезает вся. Поиск и очереди модерации выпрыгивают из
// drill-down в плоский список: там компания не является осью навигации.
//
// Панель рисует ListWrapper — здесь только её содержимое.
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
        <div
          className="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2"
          style={{ borderBottom: "1px solid var(--border-soft)" }}
        >
          <Button variant="ghost" size="sm" onClick={() => setOpenCompany(null)}>
            <RiArrowLeftLine /> Все компании
          </Button>
          <span className="tw:ms-auto tw:text-sm tw:text-muted-foreground tw:tabular-nums">
            {active.title} · {active.notes.length}
          </span>
        </div>
        {/* Компания уже в шапке — не повторяем её на каждой строке */}
        <NoteList notes={active.notes} flat showCompanies={false} />
      </>
    );
  }

  return (
    <div>
      {groups.map((group, index) => {
        const unapproved = group.notes.filter(
          (note) => note.approved !== true,
        ).length;

        return (
          <button
            key={group.key}
            type="button"
            onClick={() => setOpenCompany(group.key)}
            className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-3 tw:border-0 tw:bg-transparent tw:px-4 tw:py-3 tw:text-start tw:text-foreground tw:transition-colors tw:hover:bg-accent/60"
            style={
              index > 0
                ? { borderTop: "1px solid var(--border-soft)" }
                : undefined
            }
          >
            <span className="tw:min-w-0 tw:flex-1">
              <span className="tw:block tw:truncate tw:text-base tw:font-medium">
                {group.title}
              </span>
              {unapproved > 0 && (
                <span className="tw:block tw:text-sm tw:text-muted-foreground tw:tabular-nums">
                  {unapproved}{" "}
                  {plural(
                    unapproved,
                    "не проверена",
                    "не проверены",
                    "не проверено",
                  )}
                </span>
              )}
            </span>
            <span className="tw:flex-none tw:text-faint tw:tabular-nums">
              {group.notes.length}
            </span>
            <RiArrowRightSLine
              size={18}
              aria-hidden
              className="tw:flex-none tw:text-faint"
            />
          </button>
        );
      })}
    </div>
  );
};

export default CompanyFolders;

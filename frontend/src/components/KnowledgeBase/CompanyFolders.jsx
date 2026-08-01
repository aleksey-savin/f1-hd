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
  const setOpenCompany = useKnowledgeNotesStore(
    (state) => state.setOpenCompany,
  );

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
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--border-soft)" }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpenCompany(null)}
          >
            <RiArrowLeftLine /> Все компании
          </Button>
          <span className="ms-auto text-sm text-muted-foreground tabular-nums">
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
            className="flex w-full cursor-pointer appearance-none items-center gap-3 border-0 bg-transparent px-4 py-3 text-start text-foreground transition-colors hover:bg-accent/60"
            style={
              index > 0
                ? { borderTop: "1px solid var(--border-soft)" }
                : undefined
            }
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium">
                {group.title}
              </span>
              {unapproved > 0 && (
                <span className="block text-sm text-muted-foreground tabular-nums">
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
            <span className="flex-none text-faint tabular-nums">
              {group.notes.length}
            </span>
            <RiArrowRightSLine
              size={18}
              aria-hidden
              className="flex-none text-faint"
            />
          </button>
        );
      })}
    </div>
  );
};

export default CompanyFolders;

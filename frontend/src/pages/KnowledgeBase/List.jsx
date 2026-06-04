import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import { RiBookOpenLine } from "react-icons/ri";

import useSidebarStore from "../../store/sidebar";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import KnowledgeBaseSidebar from "../../components/KnowledgeBase/Sidebar";

const Placeholder = () => (
  <div className="text-center text-secondary py-5">
    <RiBookOpenLine size={48} className="mb-3" />
    <p className="mb-0">Выберите заметку слева или создайте новую</p>
  </div>
);

const KnowledgeBaseList = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const store = useKnowledgeNotesStore();

  // Заметки не грузим автоматически — только когда применён поиск/фильтр
  // (логика в Sidebar). Здесь лишь пересчитываем список при обновлении данных.
  useEffect(() => {
    store.applyFilter();
  }, [store.originalList]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <KnowledgeBaseSidebar />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, store.originalList]);

  const atRoot =
    location.pathname === "/knowledge-base" ||
    location.pathname === "/knowledge-base/";

  return (
    <>
      <BrowserView>{atRoot ? <Placeholder /> : <Outlet />}</BrowserView>
      <MobileView>{atRoot ? <KnowledgeBaseSidebar /> : <Outlet />}</MobileView>
    </>
  );
};

export default KnowledgeBaseList;

export async function loader() {
  document.title = "F1 HD | База знаний";
  return null;
}

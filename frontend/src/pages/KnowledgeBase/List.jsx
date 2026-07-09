import { useContext, useEffect } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import { RiBookOpenLine } from "react-icons/ri";

import ListWrapper from "../../UI/ListWrapper";
import useSidebarStore from "../../store/sidebar";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import { AuthedUserContext } from "../../store/authed-user-context";
import KnowledgeBaseExplorer from "../../components/KnowledgeBase/Explorer";
import KnowledgeBaseFilter, {
  isFilterActive,
} from "../../components/KnowledgeBase/Filter";
import NoteList from "../../components/KnowledgeBase/NoteList";
import CompanyFolders from "../../components/KnowledgeBase/CompanyFolders";

const Placeholder = () => (
  <div className="text-center text-body-secondary py-5">
    <RiBookOpenLine size={48} className="mb-3" />
    <p className="mb-0">Выберите заметку слева или создайте новую</p>
  </div>
);

const MODERATION_MODES = [
  "all-unapproved",
  "pending-deletion",
  "pending-archive",
  "flagged-secrets",
];

const title = () => (
  <>
    <RiBookOpenLine /> База знаний
  </>
);

const KnowledgeBaseList = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setLeftSidebarContent } = useSidebarStore();
  const store = useKnowledgeNotesStore();
  const { isAdmin, permissions } = useContext(AuthedUserContext);
  const canManage = isAdmin || permissions?.canManageKnowledgeBase;

  const moderationParam = searchParams.get("moderation");

  // Заметки грузим сразу: по умолчанию список показывает всё, что доступно
  // пользователю, сгруппированное по компаниям.
  useEffect(() => {
    store.ensureLoaded();
  }, []);

  // Вход в режим модерации по ссылке с карточки/алерта. Режим НЕ сбрасываем при
  // переходе к заметке или назад — им управляют кнопки очередей в проводнике.
  // Иначе при открытии заметки список модерации терялся бы (параметр уходит из URL).
  useEffect(() => {
    if (moderationParam && MODERATION_MODES.includes(moderationParam)) {
      store.setModerationMode(moderationParam);
    }
  }, [moderationParam]);

  useEffect(() => {
    store.applyFilter();
  }, [store.originalList]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <KnowledgeBaseExplorer />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, store.originalList]);

  const atRoot =
    location.pathname === "/knowledge-base" ||
    location.pathname === "/knowledge-base/";

  // Мобайл: подсветка кнопки «Фильтр», когда выбрано что-то помимо значений по
  // умолчанию. Поиск не учитываем — у него свой видимый индикатор.
  const filterActive = isFilterActive(store);

  // Компания — ось навигации только в обычном просмотре. Поиск и очереди
  // модерации отвечают на другой вопрос («где это сказано», «что разобрать»),
  // поэтому показывают плоский список результатов.
  const useDrillDown = !store.searchTerm.trim() && !store.moderationMode;

  return (
    <>
      <BrowserView>{atRoot ? <Placeholder /> : <Outlet />}</BrowserView>
      <MobileView>
        {atRoot ? (
          <ListWrapper
            title={title}
            filter={<KnowledgeBaseFilter />}
            filterStore={store}
            filterActive={filterActive}
            showRefreshButton={false}
            hiddenAddButton={!canManage}
            // Формы базы знаний открываются в основной панели, а не в нижнем
            // Offcanvas: <Outlet/> рендерит сама эта страница.
            renderOutlet={false}
            onAddClick={() => navigate("/knowledge-base/add")}
          >
            {useDrillDown ? <CompanyFolders /> : <NoteList flat />}
          </ListWrapper>
        ) : (
          <Outlet />
        )}
      </MobileView>
    </>
  );
};

export default KnowledgeBaseList;

export async function loader() {
  document.title = "F1 HD | База знаний";
  return null;
}

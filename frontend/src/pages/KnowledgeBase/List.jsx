import { useContext, useEffect } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import { RiBookOpenLine, RiAddFill, RiShieldCheckLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import ListWrapper from "@/components/app/ListWrapper";

import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import useKnowledgeModerationStore from "../../store/knowledgeModeration";
import useInitialPrefsStore from "../../store/prefs";
import { AuthedUserContext } from "../../store/authed-user-context";
import { plural } from "../../util/plural";
import KnowledgeBaseExplorer from "../../components/KnowledgeBase/Explorer";
import KnowledgeBaseFilter, {
  isFilterActive,
  ModerationMenu,
} from "../../components/KnowledgeBase/Filter";
import NoteList from "../../components/KnowledgeBase/NoteList";
import NoteBulkActionBar from "../../components/KnowledgeBase/NoteBulkActionBar";
import CompanyFolders from "../../components/KnowledgeBase/CompanyFolders";

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

// Правая панель, пока заметка не выбрана. Пустое состояние не «пустота»: оно
// говорит, где ты, и предлагает действие — в том числе прямой вход в очередь,
// если модератору есть что разобрать (docs/ux-ui-guide.md).
const Placeholder = ({ canManage }) => {
  const count = useKnowledgeNotesStore((state) => state.filteredList.length);
  const setModerationMode = useKnowledgeNotesStore(
    (state) => state.setModerationMode,
  );
  // Счётчики читаем из общего стора, не через useModerationSummary: сводку уже
  // запросила кнопка очередей в рейле, второй запрос на той же странице лишний
  const isModerator = useInitialPrefsStore(
    (state) => state.knowledgeBase.isModerator,
  );
  const pending = useKnowledgeModerationStore(
    (state) => state.counts.pendingApproval,
  );

  return (
    <div className="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:px-6 tw:py-24 tw:text-center">
      <RiBookOpenLine size={48} aria-hidden className="tw:mb-1 tw:text-faint" />
      <div className="tw:text-lg tw:font-semibold">
        {count} {plural(count, "заметка", "заметки", "заметок")} о клиентах и
        наших порядках
      </div>
      <p className="tw:my-0 tw:max-w-md tw:text-base tw:text-muted-foreground">
        Выберите заметку в списке или найдите по тексту — поиск идёт по
        заголовку, содержимому, компаниям и категориям.
      </p>
      <div className="tw:mt-3 tw:flex tw:flex-wrap tw:justify-center tw:gap-2">
        {canManage && (
          <Button asChild>
            <Link to="/knowledge-base/add">
              <RiAddFill /> Новая заметка
            </Link>
          </Button>
        )}
        {isModerator && pending > 0 && (
          <Button
            variant="outline"
            onClick={() => setModerationMode("all-unapproved")}
          >
            <RiShieldCheckLine /> {pending}{" "}
            {plural(pending, "ждёт", "ждут", "ждут")} проверки
          </Button>
        )}
      </div>
    </div>
  );
};

// Раздел «База знаний».
//
// Десктоп — двухпанельная раскладка, которую страница рисует сама: слева
// проводник (Explorer), справа заметка. Сайдбар оболочки для этого больше не
// используется — мигрированный экран не живёт в легаси-каркасе.
// Мобайл — обычная страница-список на ListWrapper с drill-down по компаниям;
// заметка открывается отдельным экраном.
const KnowledgeBaseList = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  // переходе к заметке или назад — им управляют очереди в проводнике.
  // Иначе при открытии заметки список модерации терялся бы (параметр уходит из URL).
  useEffect(() => {
    if (moderationParam && MODERATION_MODES.includes(moderationParam)) {
      store.setModerationMode(moderationParam);
    }
  }, [moderationParam]);

  useEffect(() => {
    store.applyFilter();
  }, [store.originalList]);

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
      <BrowserView>
        <div className="tw:mx-auto tw:flex tw:w-full tw:max-w-7xl tw:items-start tw:gap-6">
          <KnowledgeBaseExplorer />
          <div className="tw:min-w-0 tw:flex-1">
            {atRoot ? <Placeholder canManage={canManage} /> : <Outlet />}
          </div>
        </div>
      </BrowserView>

      <MobileView>
        {atRoot ? (
          <>
            <ListWrapper
              title={title}
              filter={<KnowledgeBaseFilter />}
              filterStore={store}
              filterActive={filterActive}
              toolbar={<ModerationMenu />}
              showRefreshButton={false}
              hiddenAddButton={!canManage}
              // Формы базы знаний открываются в основной панели, а не в нижней
              // шторке: <Outlet/> рендерит сама эта страница.
              renderOutlet={false}
              onAddClick={() => navigate("/knowledge-base/add")}
              addLabel="Новая заметка"
            >
              {useDrillDown ? <CompanyFolders /> : <NoteList flat />}
            </ListWrapper>
            <NoteBulkActionBar />
          </>
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

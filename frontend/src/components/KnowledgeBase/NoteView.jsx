import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useBlocker } from "react-router";
import { isMobile, MobileView } from "react-device-detect";

import { RiArrowLeftLine, RiSaveLine } from "react-icons/ri";

import MarkdownEditor from "../../UI/MarkdownEditor";
import MarkdownViewer from "../../UI/MarkdownViewer";
import ConfirmActionModal from "../../UI/ConfirmActionModal";
import MobileActionBar from "../../UI/MobileActionBar";

import useHttp from "../../hooks/use-http";
import useToastStore from "../../store/toast-store";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
import useInitialPrefsStore from "../../store/prefs";

import NoteHero from "./NoteHero";
import NoteActions from "./NoteActions";
import NoteProperties from "./NoteProperties";
import PendingRequestAlert from "./PendingRequestAlert";
import SecretsAlert from "./SecretsAlert";
import VerifyModal from "./VerifyModal";
import ConfirmDeletionModal from "./ConfirmDeletionModal";

import "../../UI/knowledgeBase.css";

const API = import.meta.env.VITE_API_ADDRESS;

// Высота редактора на десктопе: карточка Root минус навбар и паддинги.
// На мобайле фиксированная высота не годится — редактор живёт внутри
// .mobile-shell__scroll и должен расти по содержимому (см. docs/ux-ui-guide.md).
const EDITOR_HEIGHT = isMobile ? "auto" : "calc(100svh - 300px)";

const idsOf = (list = []) => (list || []).map((item) => String(item._id)).sort();
const sameIds = (a, b) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const NoteView = ({ note: initialNote = null, mode: initialMode = "read" }) => {
  const navigate = useNavigate();
  const { token } = getLocalStorageData();
  const { showToast } = useToastStore();
  const { sendRequest, isLoading } = useHttp();
  const refreshNotes = useKnowledgeNotesStore((state) => state.fetch);
  // Активные фильтры списка — для предзаполнения новой заметки
  const filterCompanies = useKnowledgeNotesStore((state) => state.companies);
  const filterUsers = useKnowledgeNotesStore((state) => state.users);
  const filterCategories = useKnowledgeNotesStore((state) => state.categories);

  const { isAdmin, permissions } = useContext(AuthedUserContext);
  const canManage = isAdmin || permissions?.canManageKnowledgeBase;
  const isModerator = useInitialPrefsStore(
    (state) => state.knowledgeBase.isModerator,
  );

  const isNew = !initialNote?._id;

  const [currentNote, setCurrentNote] = useState(initialNote);
  const [mode, setMode] = useState(initialMode);
  const isEditing = mode === "edit";

  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRequestArchiveModal, setShowRequestArchiveModal] = useState(false);

  // Редактируемые поля (инициализируются из заметки, сбрасываются при отмене)
  const [title, setTitle] = useState(initialNote?.title || "");
  const [content, setContent] = useState(initialNote?.content || "");
  const [companies, setCompanies] = useState(initialNote?.companies || []);
  const [users, setUsers] = useState(initialNote?.users || []);
  const [categories, setCategories] = useState(initialNote?.categories || []);
  const [type, setType] = useState(initialNote?.type || "info");

  // Опции селектов связей — грузятся лениво (только для редактирования)
  const [formData, setFormData] = useState(null);
  const prefilledRef = useRef(false);
  // Индекс блока, по которому пользователь дважды кликнул: после монтирования
  // редактора прокручиваем к нему и ставим туда каретку.
  const pendingCaretRef = useRef(null);
  const viewerRef = useRef(null);
  // Наши собственные переходы (сохранили новую заметку, отменили её создание)
  // не должны упираться в блокировку «есть несохранённые изменения».
  const bypassBlockRef = useRef(false);

  const resetFields = (note) => {
    setTitle(note?.title || "");
    setContent(note?.content || "");
    setCompanies(note?.companies || []);
    setUsers(note?.users || []);
    setCategories(note?.categories || []);
    setType(note?.type || "info");
  };

  // Есть ли несохранённые изменения. Считаем честно по всем редактируемым полям:
  // на этом же признаке стоит блокировка перехода со страницы.
  const isDirty =
    isEditing &&
    (title !== (currentNote?.title || "") ||
      content !== (currentNote?.content || "") ||
      type !== (currentNote?.type || "info") ||
      !sameIds(idsOf(companies), idsOf(currentNote?.companies)) ||
      !sameIds(idsOf(users), idsOf(currentNote?.users)) ||
      !sameIds(idsOf(categories), idsOf(currentNote?.categories)));

  const loadFormData = (onReady) => {
    if (formData) {
      return onReady?.();
    }
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/form-data`,
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось загрузить данные формы",
          );
        }
        setFormData(data);
        onReady?.();
      },
    );
  };

  // Новая заметка сразу в режиме редактирования — подгружаем опции связей
  useEffect(() => {
    if (isNew) {
      loadFormData();
    }
  }, []);

  // Новая заметка: переносим активные фильтры списка (компания/категория/
  // пользователь) в форму — один раз, после загрузки опций связей.
  useEffect(() => {
    if (!isNew || !formData || prefilledRef.current) {
      return;
    }
    prefilledRef.current = true;
    // Берём объекты из formData, а не из фильтра: в селекте значение должно быть
    // тем же объектом, что и опция.
    const pick = (list, selected) => {
      const ids = new Set((selected || []).map((item) => item._id.toString()));
      return (list || []).filter((item) => ids.has(item._id.toString()));
    };
    setCompanies(pick(formData.companies, filterCompanies));
    setUsers(pick(formData.users, filterUsers));
    setCategories(pick(formData.categories, filterCategories));
  }, [formData, isNew, filterCompanies, filterUsers, filterCategories]);

  const enterEdit = useCallback(
    (blockIndex = null) => {
      if (!canManage || currentNote?.archivedAt) {
        return;
      }
      pendingCaretRef.current = blockIndex;
      resetFields(currentNote);
      loadFormData(() => setMode("edit"));
    },
    [canManage, currentNote, formData],
  );

  const cancelEdit = useCallback(() => {
    if (isNew) {
      bypassBlockRef.current = true;
      return navigate("/knowledge-base");
    }
    resetFields(currentNote);
    setMode("read");
  }, [isNew, navigate, currentNote]);

  const saveHandler = useCallback(
    (event) => {
      event?.preventDefault?.();

      if (!title.trim()) {
        return showToast("danger text-white", "Заголовок обязателен");
      }
      if (!content.trim()) {
        return showToast("danger text-white", "Заполните содержимое заметки");
      }

      const url = isNew
        ? `${API}/api/knowledge-notes/add`
        : `${API}/api/knowledge-notes/update/${currentNote._id}`;

      sendRequest(
        {
          url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: {
            title: title.trim(),
            content,
            companies: companies.map((company) => company._id),
            users: users.map((user) => user._id),
            categories: categories.map((category) => category._id),
            type,
          },
        },
        (data) => {
          if (!data || data.error) {
            return showToast(
              "danger text-white",
              data?.message || "Не удалось сохранить заметку",
            );
          }
          showToast(
            "success text-white",
            isNew ? "Заметка создана" : "Заметка обновлена",
          );
          refreshNotes();
          if (isNew) {
            bypassBlockRef.current = true;
            navigate(`/knowledge-base/${data.note._id}`);
          } else {
            setCurrentNote(data.note);
            resetFields(data.note);
            setMode("read");
          }
        },
      );
    },
    [title, content, companies, users, categories, type, isNew, currentNote],
  );

  // ── Действия жизненного цикла ──────────────────────────────────────────
  // Все ходят одним путём: POST, тост, обновлённая заметка в стейт, рефреш списка.
  const lifecycleRequest = (path, { body, success, failure, onDone } = {}) => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/${path}`,
        method: "POST",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          Authorization: "Bearer " + token,
        },
        ...(body ? { body } : {}),
      },
      (data) => {
        if (!data || data.error) {
          return showToast("danger text-white", data?.message || failure);
        }
        showToast("success text-white", success);
        if (data.note) {
          setCurrentNote(data.note);
        }
        refreshNotes();
        onDone?.();
      },
    );
  };

  const verifyHandler = ({ confirmCurrent, confirmNoSecrets }, reset) =>
    lifecycleRequest(`approve/${currentNote._id}`, {
      body: { confirmCurrent, confirmNoSecrets },
      success: "Заметка отмечена как проверенная",
      failure: "Не удалось отметить заметку проверенной",
      onDone: () => {
        reset?.();
        setShowVerifyModal(false);
      },
    });

  const sendToDeletionHandler = () =>
    lifecycleRequest(`send-to-deletion/${currentNote._id}`, {
      success: "Заметка отправлена на удаление",
      failure: "Не удалось отправить заметку на удаление",
    });

  const declineDeletionHandler = () =>
    lifecycleRequest(`decline-deletion/${currentNote._id}`, {
      success: "Запрос на удаление отклонён",
      failure: "Не удалось отклонить запрос",
    });

  const requestArchiveHandler = () =>
    lifecycleRequest(`request-archive/${currentNote._id}`, {
      success: "Запрошена архивация заметки",
      failure: "Не удалось запросить архивацию",
      onDone: () => setShowRequestArchiveModal(false),
    });

  const confirmArchiveHandler = () =>
    lifecycleRequest(`confirm-archive/${currentNote._id}`, {
      success: "Заметка перемещена в архив",
      failure: "Не удалось архивировать заметку",
    });

  const declineArchiveHandler = () =>
    lifecycleRequest(`decline-archive/${currentNote._id}`, {
      success: "Запрос на архивацию отклонён",
      failure: "Не удалось отклонить запрос",
    });

  const unarchiveHandler = () =>
    lifecycleRequest(`unarchive/${currentNote._id}`, {
      success: "Заметка восстановлена из архива",
      failure: "Не удалось восстановить заметку",
    });

  const ignoreSecretHandler = (hash) =>
    lifecycleRequest(`${currentNote._id}/ignore-secret`, {
      body: { hash },
      success: "Находка помечена как не секрет",
      failure: "Не удалось обновить находку",
    });

  // Подтверждение удаления модератором — безвозвратный прун из БД
  const confirmDeletionHandler = () => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/confirm-deletion/${currentNote._id}`,
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        if (data?.error) {
          return showToast(
            "danger text-white",
            data.message || "Не удалось удалить заметку",
          );
        }
        showToast("success text-white", "Заметка удалена");
        setShowDeleteModal(false);
        refreshNotes();
        navigate("/knowledge-base");
      },
    );
  };

  // ── Правка на месте ────────────────────────────────────────────────────

  // Двойной клик по тексту открывает правку в том же месте. Ссылки и чекбоксы
  // списков задач исключаем: по ним кликают, чтобы перейти/отметить.
  const bodyDoubleClickHandler = (event) => {
    if (!canManage || isEditing || currentNote?.archivedAt) {
      return;
    }
    if (event.target.closest("a, input[type='checkbox']")) {
      return;
    }
    const block = event.target.closest(".toastui-editor-contents > *");
    const contents = viewerRef.current?.querySelector(".toastui-editor-contents");
    const index =
      block && contents ? [...contents.children].indexOf(block) : null;
    enterEdit(index !== null && index >= 0 ? index : null);
  };

  // Редактор смонтирован: прокручиваем к блоку, по которому кликнули, и ставим
  // туда каретку. Точного посимвольного соответствия между вьюером и редактором
  // нет (в WYSIWYG позиция — offset ProseMirror-документа), поэтому целимся в
  // начало блока; не вышло — фокус в начало заметки.
  const editorReadyHandler = useCallback((editor) => {
    const index = pendingCaretRef.current;
    pendingCaretRef.current = null;

    if (index === null || index === undefined) {
      return;
    }

    const contents = document.querySelector(
      ".kb-doc .toastui-editor-ww-container .toastui-editor-contents",
    );
    const block = contents?.children?.[index];

    if (!block) {
      return editor.moveCursorToStart(true);
    }

    block.scrollIntoView({ block: "center" });
    try {
      const range = document.createRange();
      range.setStart(block, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      editor.focus();
    } catch {
      editor.moveCursorToStart(true);
    }
  }, []);

  // Ctrl/Cmd+E — переключить режим, Ctrl/Cmd+S — сохранить, Esc — выйти.
  // Esc игнорируем, когда фокус в поле ввода (там он закрывает выпадающий
  // список react-select), а Ctrl+S ловим всегда — иначе он уходит браузеру.
  useEffect(() => {
    const handler = (event) => {
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;

      if (mod && key === "s") {
        event.preventDefault();
        if (isEditing) {
          saveHandler();
        }
        return;
      }

      const inField = ["INPUT", "TEXTAREA"].includes(
        document.activeElement?.tagName,
      );

      if (mod && key === "e") {
        event.preventDefault();
        return isEditing ? cancelEdit() : enterEdit();
      }

      if (event.key === "Escape" && isEditing && !inField) {
        event.preventDefault();
        cancelEdit();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isEditing, saveHandler, cancelEdit, enterEdit]);

  // Уход со страницы с несохранёнными правками. Роутер данных умеет блокировать
  // переход; закрытие вкладки перехватываем стандартным beforeunload.
  const blocker = useBlocker(() => isDirty && !bypassBlockRef.current);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const handler = (event) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // На мобилке кнопки правки уезжают в плавающий остров: шапка прокручивается,
  // а «Сохранить» должно оставаться под большим пальцем.
  const inlineActions = isMobile && isEditing ? null : (
    <NoteActions
      note={currentNote}
      isNew={isNew}
      isEditing={isEditing}
      isLoading={isLoading}
      canManage={canManage}
      isModerator={isModerator}
      onEdit={() => enterEdit()}
      onSave={saveHandler}
      onCancel={cancelEdit}
      onVerify={() => setShowVerifyModal(true)}
      onSendToDeletion={sendToDeletionHandler}
      onRequestArchive={() => setShowRequestArchiveModal(true)}
      onUnarchive={unarchiveHandler}
    />
  );

  return (
    <article className="kb-note">
      <MobileView>
        <Link
          to="/knowledge-base"
          className="d-inline-flex align-items-center gap-1 mb-3"
        >
          <RiArrowLeftLine /> К списку
        </Link>
      </MobileView>

      <NoteHero
        note={currentNote}
        isNew={isNew}
        isEditing={isEditing}
        title={title}
        type={type}
        onTitleChange={setTitle}
        actions={inlineActions}
      />

      {!isEditing && (
        <PendingRequestAlert
          note={currentNote}
          isModerator={isModerator}
          isLoading={isLoading}
          onConfirmDeletion={() => setShowDeleteModal(true)}
          onDeclineDeletion={declineDeletionHandler}
          onConfirmArchive={confirmArchiveHandler}
          onDeclineArchive={declineArchiveHandler}
        />
      )}

      {!isEditing && (
        <SecretsAlert
          note={currentNote}
          isModerator={isModerator}
          isLoading={isLoading}
          onIgnore={ignoreSecretHandler}
        />
      )}

      <NoteProperties
        isEditing={isEditing}
        type={type}
        categories={isEditing ? categories : currentNote?.categories || []}
        companies={isEditing ? companies : currentNote?.companies || []}
        users={isEditing ? users : currentNote?.users || []}
        formData={formData || {}}
        onTypeChange={setType}
        onCategoriesChange={setCategories}
        onCompaniesChange={setCompanies}
        onUsersChange={setUsers}
      />

      {/* Вьюер и WYSIWYG-редактор рендерят в один и тот же .toastui-editor-contents,
          поэтому текст в обоих режимах стоит на месте (см. knowledgeBase.css). */}
      <div className="kb-doc">
        {isEditing ? (
          <MarkdownEditor
            initialValue={content}
            onChange={setContent}
            onReady={editorReadyHandler}
            height={EDITOR_HEIGHT}
          />
        ) : (
          <div
            ref={viewerRef}
            onDoubleClick={bodyDoubleClickHandler}
            title={
              canManage && !currentNote?.archivedAt
                ? "Двойной клик — редактировать (Ctrl+E)"
                : undefined
            }
          >
            <MarkdownViewer value={currentNote?.content || ""} />
          </div>
        )}
      </div>

      {isMobile && (
        <MobileActionBar
          show={isEditing}
          statusText={isDirty ? "Есть несохранённые изменения" : "Правка"}
          actions={[{ key: "save", icon: RiSaveLine, label: "Сохранить" }]}
          isLoading={isLoading}
          onPick={() => saveHandler()}
          onCancel={cancelEdit}
          ariaLabel="Действия над заметкой"
        />
      )}

      <VerifyModal
        show={showVerifyModal}
        onHide={() => setShowVerifyModal(false)}
        onConfirm={verifyHandler}
        isLoading={isLoading}
      />

      <ConfirmDeletionModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={confirmDeletionHandler}
        isLoading={isLoading}
      />

      <ConfirmActionModal
        show={showRequestArchiveModal}
        onHide={() => setShowRequestArchiveModal(false)}
        onConfirm={requestArchiveHandler}
        title="Запросить архивацию"
        body="Заметка будет отправлена на архивацию и после подтверждения модератором скрыта из базы знаний. Продолжить?"
        confirmLabel="Запросить"
        confirmVariant="secondary"
        isLoading={isLoading}
      />

      <ConfirmActionModal
        show={blocker.state === "blocked"}
        onHide={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        title="Несохранённые изменения"
        body="Заметка изменена, но не сохранена. Уйти со страницы и потерять правки?"
        confirmLabel="Уйти без сохранения"
        confirmVariant="danger"
      />
    </article>
  );
};

export default NoteView;

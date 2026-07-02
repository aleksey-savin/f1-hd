import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Alert from "react-bootstrap/Alert";
import ListGroup from "react-bootstrap/ListGroup";
import Dropdown from "react-bootstrap/Dropdown";

import {
  RiEditLine,
  RiDeleteBinLine,
  RiDeleteBin6Line,
  RiSaveLine,
  RiArrowGoBackFill,
  RiBuilding2Line,
  RiAccountBoxLine,
  RiPriceTag3Line,
  RiCheckboxCircleLine,
  RiShieldKeyholeLine,
  RiArchiveLine,
  RiInboxArchiveLine,
  RiInboxUnarchiveLine,
  RiCloseLine,
} from "react-icons/ri";

import Select from "../../UI/Select";
import MarkdownEditor from "../../UI/MarkdownEditor";
import MarkdownViewer from "../../UI/MarkdownViewer";

import useHttp from "../../hooks/use-http";
import useToastStore from "../../store/toast-store";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
import { NOTE_TYPES, getNoteTypeMeta } from "../../util/knowledgeNoteTypes";
import useInitialPrefsStore from "../../store/prefs";
import NoteStatusBadges from "./NoteStatusBadges";
import ApprovalModal from "./ApprovalModal";
import ConfirmDeletionModal from "./ConfirmDeletionModal";
import ConfirmActionModal from "../../UI/ConfirmActionModal";

import "../../UI/knowledgeBase.css";

const API = import.meta.env.VITE_API_ADDRESS;

// Единый компонент заметки: режимы "read" (по умолчанию) и "edit" с одинаковой
// вёрсткой. Верхняя строка — связи + действия; ниже заголовок, затем содержимое.
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

  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRequestArchiveModal, setShowRequestArchiveModal] = useState(false);
  const [showConfirmArchiveModal, setShowConfirmArchiveModal] = useState(false);

  const isNew = !initialNote?._id;

  const [currentNote, setCurrentNote] = useState(initialNote);
  const [mode, setMode] = useState(initialMode);
  const isEditing = mode === "edit";

  // Редактируемые поля (инициализируются из заметки, сбрасываются при отмене)
  const [title, setTitle] = useState(initialNote?.title || "");
  const [content, setContent] = useState(initialNote?.content || "");
  const [companies, setCompanies] = useState(initialNote?.companies || []);
  const [users, setUsers] = useState(initialNote?.users || []);
  const [categories, setCategories] = useState(initialNote?.categories || []);
  const [type, setType] = useState(initialNote?.type || "info");

  // Опции селектов связей — грузятся лениво (только для редактирования)
  const [formData, setFormData] = useState(null);
  // Предзаполнение новой заметки активными фильтрами делаем один раз
  const prefilledRef = useRef(false);

  const resetFields = (note) => {
    setTitle(note?.title || "");
    setContent(note?.content || "");
    setCompanies(note?.companies || []);
    setUsers(note?.users || []);
    setCategories(note?.categories || []);
    setType(note?.type || "info");
  };

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
    const pick = (list, ids) =>
      (list || []).filter((item) =>
        (ids || []).map(String).includes(item._id.toString()),
      );
    setCompanies(pick(formData.companies, filterCompanies));
    setUsers(pick(formData.users, filterUsers));
    setCategories(pick(formData.categories, filterCategories));
  }, [formData, isNew, filterCompanies, filterUsers, filterCategories]);

  const enterEdit = () => {
    resetFields(currentNote);
    loadFormData(() => setMode("edit"));
  };

  const cancelEdit = () => {
    if (isNew) {
      return navigate("/knowledge-base");
    }
    resetFields(currentNote);
    setMode("read");
  };

  const saveHandler = (event) => {
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
          navigate(`/knowledge-base/${data.note._id}`);
        } else {
          setCurrentNote(data.note);
          resetFields(data.note);
          setMode("read");
        }
      },
    );
  };

  // Менеджер отправляет заметку на удаление (мягко); прунит её позже модератор
  const sendToDeletionHandler = () => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/send-to-deletion/${currentNote._id}`,
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось отправить заметку на удаление",
          );
        }
        showToast("success text-white", "Заметка отправлена на удаление");
        setCurrentNote(data.note);
        refreshNotes();
      },
    );
  };

  // Одобрение модератором (после подтверждения обоих условий в диалоге)
  const approveHandler = ({ confirmCurrent, confirmNoSecrets }, reset) => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/approve/${currentNote._id}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: { confirmCurrent, confirmNoSecrets },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось одобрить заметку",
          );
        }
        showToast("success text-white", "Заметка одобрена");
        reset?.();
        setShowApproveModal(false);
        setCurrentNote(data.note);
        refreshNotes();
      },
    );
  };

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

  // Модератор помечает находку секрета как «не секрет» (ложное срабатывание)
  const ignoreSecretHandler = (hash) => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/${currentNote._id}/ignore-secret`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: { hash },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось обновить находку",
          );
        }
        showToast("success text-white", "Находка помечена как не секрет");
        setCurrentNote(data.note);
        refreshNotes();
      },
    );
  };

  // Менеджер запрашивает архивацию (мягко); подтверждает её модератор
  const requestArchiveHandler = () => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/request-archive/${currentNote._id}`,
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось запросить архивацию",
          );
        }
        showToast("success text-white", "Запрошена архивация заметки");
        setShowRequestArchiveModal(false);
        setCurrentNote(data.note);
        refreshNotes();
      },
    );
  };

  // Подтверждение архивации модератором — заметка уходит в архив
  const confirmArchiveHandler = () => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/confirm-archive/${currentNote._id}`,
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось архивировать заметку",
          );
        }
        showToast("success text-white", "Заметка перемещена в архив");
        setShowConfirmArchiveModal(false);
        setCurrentNote(data.note);
        refreshNotes();
      },
    );
  };

  // Восстановление заметки из архива (менеджер)
  const unarchiveHandler = () => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/unarchive/${currentNote._id}`,
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось восстановить заметку",
          );
        }
        showToast("success text-white", "Заметка восстановлена из архива");
        setCurrentNote(data.note);
        refreshNotes();
      },
    );
  };

  // Модератор отклоняет запрос на удаление — снимает pendingDeletion
  const declineDeletionHandler = () => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/decline-deletion/${currentNote._id}`,
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось отклонить запрос",
          );
        }
        showToast("success text-white", "Запрос на удаление отклонён");
        setCurrentNote(data.note);
        refreshNotes();
      },
    );
  };

  // Модератор отклоняет запрос на архивацию — снимает pendingArchive
  const declineArchiveHandler = () => {
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/decline-archive/${currentNote._id}`,
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        if (!data || data.error) {
          return showToast(
            "danger text-white",
            data?.message || "Не удалось отклонить запрос",
          );
        }
        showToast("success text-white", "Запрос на архивацию отклонён");
        setCurrentNote(data.note);
        refreshNotes();
      },
    );
  };

  const fd = formData || {};

  // Кнопки режима редактирования
  const editActions = (
    <>
      <Button variant="primary" onClick={saveHandler} disabled={isLoading}>
        <RiSaveLine /> Сохранить
      </Button>
      <Button
        variant="outline-secondary"
        onClick={cancelEdit}
        disabled={isLoading}
      >
        <RiArrowGoBackFill /> Отмена
      </Button>
    </>
  );

  // Пункты меню «Действия» в режиме просмотра (модерация / жизненный цикл).
  // Собираем массивом, чтобы не показывать пустое меню и избежать дублей «Отклонить».
  const moderationItems = [];
  if (currentNote && !currentNote.archivedAt) {
    if (isModerator && currentNote.approved !== true) {
      moderationItems.push(
        <Dropdown.Item key="approve" onClick={() => setShowApproveModal(true)}>
          <RiCheckboxCircleLine className="text-success me-2" />
          Одобрить
        </Dropdown.Item>,
      );
    }
    if (canManage && !currentNote.pendingDeletion) {
      moderationItems.push(
        <Dropdown.Item key="send-del" onClick={sendToDeletionHandler}>
          <RiDeleteBinLine className="me-2" />
          Отправить на удаление
        </Dropdown.Item>,
      );
    }
    if (isModerator && currentNote.pendingDeletion) {
      moderationItems.push(
        <Dropdown.Item
          key="confirm-del"
          className="text-danger"
          onClick={() => setShowDeleteModal(true)}
        >
          <RiDeleteBin6Line className="me-2" />
          Подтвердить удаление
        </Dropdown.Item>,
        <Dropdown.Item key="decline-del" onClick={declineDeletionHandler}>
          <RiCloseLine className="me-2" />
          Отклонить запрос на удаление
        </Dropdown.Item>,
      );
    }
    if (canManage && !currentNote.pendingArchive) {
      moderationItems.push(
        <Dropdown.Item
          key="req-arch"
          onClick={() => setShowRequestArchiveModal(true)}
        >
          <RiArchiveLine className="me-2" />
          Запросить архивацию
        </Dropdown.Item>,
      );
    }
    if (isModerator && currentNote.pendingArchive) {
      moderationItems.push(
        <Dropdown.Item
          key="confirm-arch"
          onClick={() => setShowConfirmArchiveModal(true)}
        >
          <RiInboxArchiveLine className="me-2" />
          Подтвердить архивацию
        </Dropdown.Item>,
        <Dropdown.Item key="decline-arch" onClick={declineArchiveHandler}>
          <RiCloseLine className="me-2" />
          Отклонить запрос на архивацию
        </Dropdown.Item>,
      );
    }
  }

  // Действия в режиме просмотра: основная кнопка + меню. Для архивной заметки —
  // только восстановление.
  const readActions = currentNote?.archivedAt ? (
    canManage && (
      <Button
        size="sm"
        variant="outline-primary"
        onClick={unarchiveHandler}
        disabled={isLoading}
      >
        <RiInboxUnarchiveLine /> Восстановить из архива
      </Button>
    )
  ) : (
    <>
      {canManage && (
        <Button size="sm" variant="outline-primary" onClick={enterEdit}>
          <RiEditLine /> Редактировать
        </Button>
      )}
      {moderationItems.length > 0 && (
        <Dropdown align="end">
          <Dropdown.Toggle size="sm" variant="outline-secondary">
            Действия
          </Dropdown.Toggle>
          <Dropdown.Menu>{moderationItems}</Dropdown.Menu>
        </Dropdown>
      )}
    </>
  );

  return (
    <article
      className={isEditing ? "d-flex flex-column" : undefined}
      // В режиме редактирования заметка занимает всю доступную высоту карточки
      // (как в Root: 100svh минус навбар и паддинги Card.Body), чтобы редактор
      // растянулся на оставшееся место.
      style={isEditing ? { height: "calc(100svh - 156px)" } : undefined}
    >
      {/* Верхняя строка: связи + действия в одну строку */}
      <Row className="mb-2 g-2 align-items-center">
        {isEditing ? (
          <>
            <Col xs="auto" style={{ minWidth: "10rem" }}>
              <Select
                placeholder="Тип"
                isSearchable={false}
                value={getNoteTypeMeta(type)}
                options={NOTE_TYPES}
                getOptionLabel={(option) => option.label}
                getOptionValue={(option) => option.value}
                onChange={(selected) => setType(selected?.value || "info")}
              />
            </Col>
            <Col>
              <Select
                placeholder="Категории"
                closeMenuOnSelect={false}
                isClearable
                isSearchable
                isMulti
                value={categories}
                options={fd.categories || []}
                getOptionLabel={(option) => option.title}
                getOptionValue={(option) => option._id}
                onChange={(selected) => setCategories(selected || [])}
              />
            </Col>
            <Col>
              <Select
                placeholder="Компании"
                closeMenuOnSelect={false}
                isClearable
                isSearchable
                isMulti
                value={companies}
                options={fd.companies || []}
                getOptionLabel={(option) => option.alias}
                getOptionValue={(option) => option._id}
                onChange={(selected) => setCompanies(selected || [])}
              />
            </Col>
            <Col>
              <Select
                placeholder="Пользователи"
                closeMenuOnSelect={false}
                isClearable
                isSearchable
                isMulti
                value={users}
                options={fd.users || []}
                getOptionLabel={(option) =>
                  `${option.lastName || ""} ${option.firstName || ""}`.trim()
                }
                getOptionValue={(option) => option._id}
                onChange={(selected) => setUsers(selected || [])}
              />
            </Col>
          </>
        ) : (
          <Col className="d-flex flex-wrap gap-1 align-items-center">
            <NoteStatusBadges note={currentNote} />
          </Col>
        )}

        {(isEditing || canManage || isModerator) && (
          <Col xs="auto" className="d-flex gap-2 align-items-start flex-wrap">
            {isEditing ? editActions : readActions}
          </Col>
        )}
      </Row>

      {/* Заголовок */}
      {isEditing ? (
        <Form.Control
          autoFocus
          type="text"
          placeholder="Заголовок заметки"
          className="h3 mb-2 kb-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      ) : (
        <h3 className="mb-2">{currentNote?.title}</h3>
      )}

      {/* Метаданные: тип, категории, компании, пользователи */}
      {!isEditing && (
        <div className="d-flex flex-wrap gap-1 mb-3">
          <Badge bg={getNoteTypeMeta(currentNote?.type).badge}>
            {getNoteTypeMeta(currentNote?.type).label}
          </Badge>
          {(currentNote?.categories || []).map((category) => (
            <Badge key={category._id} bg="info">
              <RiPriceTag3Line /> {category.title}
            </Badge>
          ))}
          {(currentNote?.companies || []).map((company) => (
            <Badge key={company._id} bg="secondary">
              <RiBuilding2Line /> {company.alias}
            </Badge>
          ))}
          {(currentNote?.users || []).map((user) => (
            <Badge key={user._id} className="kb-user-badge">
              <RiAccountBoxLine /> {user.lastName} {user.firstName}
            </Badge>
          ))}
        </div>
      )}

      {/* Находки секретов — только модераторам, с возможностью пометить «не секрет» */}
      {!isEditing &&
        isModerator &&
        currentNote?.secretsScan?.flagged &&
        (currentNote.secretsScan.findings || []).length > 0 && (
          <Alert variant="danger" className="mb-2">
            <div className="fw-semibold mb-2">
              <RiShieldKeyholeLine /> Возможные учётные данные
            </div>
            <ListGroup variant="flush">
              {currentNote.secretsScan.findings.map((finding, index) => (
                <ListGroup.Item
                  key={finding.hash || index}
                  className="d-flex flex-wrap align-items-center gap-2 bg-transparent px-0 border-0 py-1"
                >
                  <span>{finding.maskedSnippet}</span>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    className="ms-auto"
                    onClick={() => ignoreSecretHandler(finding.hash)}
                  >
                    Не секрет
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </Alert>
        )}

      {/* Содержимое: Markdown — редактор (edit) ↔ просмотр (read) */}
      {isEditing ? (
        <div className="flex-grow-1" style={{ minHeight: 0 }}>
          <MarkdownEditor
            initialValue={content}
            onChange={setContent}
            height="100%"
          />
        </div>
      ) : (
        <MarkdownViewer value={currentNote?.content || ""} />
      )}

      {!isNew && (
        <>
          <ApprovalModal
            show={showApproveModal}
            onHide={() => setShowApproveModal(false)}
            onConfirm={approveHandler}
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
            show={showConfirmArchiveModal}
            onHide={() => setShowConfirmArchiveModal(false)}
            onConfirm={confirmArchiveHandler}
            title="Подтверждение архивации"
            body="Заметка будет перемещена в архив и исчезнет из базы знаний. Она останется доступной через фильтр «Показать архив». Продолжить?"
            confirmLabel="В архив"
            confirmVariant="secondary"
            isLoading={isLoading}
          />
        </>
      )}
    </article>
  );
};

export default NoteView;

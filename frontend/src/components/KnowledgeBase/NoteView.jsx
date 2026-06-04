import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import {
  RiEditLine,
  RiDeleteBinLine,
  RiSaveLine,
  RiArrowGoBackFill,
  RiBuilding2Line,
  RiAccountBoxLine,
  RiPriceTag3Line,
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

  const { isAdmin, permissions } = useContext(AuthedUserContext);
  const canManage = isAdmin || permissions?.canManageKnowledgeBase;

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

  const deleteHandler = () => {
    if (!window.confirm("Удалить заметку безвозвратно?")) {
      return;
    }
    sendRequest(
      {
        url: `${API}/api/knowledge-notes/delete/${currentNote._id}`,
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
        refreshNotes();
        navigate("/knowledge-base");
      },
    );
  };

  const fd = formData || {};

  const actionButtons = isEditing ? (
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
  ) : (
    canManage && (
      <>
        <Button size="sm" variant="outline-primary" onClick={enterEdit}>
          <RiEditLine /> Редактировать
        </Button>
        <Button size="sm" variant="outline-danger" onClick={deleteHandler}>
          <RiDeleteBinLine /> Удалить
        </Button>
      </>
    )
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
          </Col>
        )}

        {(isEditing || canManage) && (
          <Col xs="auto" className="d-flex gap-2 align-items-start">
            {actionButtons}
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
    </article>
  );
};

export default NoteView;

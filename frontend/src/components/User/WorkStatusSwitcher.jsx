import { useContext, useEffect, useState } from "react";
import { useFetcher } from "react-router";

import NavDropdown from "react-bootstrap/NavDropdown";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";

import { AuthedUserContext } from "../../store/authed-user-context";
import { WORK_STATUSES } from "../../util/work-statuses";

// Секция «Мой статус» внутри пользовательского меню навбара: пункты каталога
// + необязательная заметка (видна коллегам и на Telegram-табло). Смена статуса
// уходит в action /my-account (intent=status-update); корневой лоадер
// ревалидируется самим fetcher'ом — вручную revalidate() не зовём (гонка
// «Did not find corresponding fetcher result»).
// Выбор нового статуса очищает заметку: она описывала предыдущий статус.
const WorkStatusSwitcher = () => {
  const { workStatus } = useContext(AuthedUserContext);
  const fetcher = useFetcher();

  const currentCode = workStatus?.code || "unset";
  const [note, setNote] = useState(workStatus?.note || "");

  // Синхронизируем поле после ревалидации (например, TG-кнопка очистила заметку)
  useEffect(() => {
    setNote(workStatus?.note || "");
  }, [workStatus?.note]);

  const busy = fetcher.state !== "idle";

  const submitStatus = (code, nextNote) => {
    fetcher.submit(
      { intent: "status-update", code, note: nextNote },
      { method: "post", action: "/my-account" },
    );
  };

  return (
    <>
      <NavDropdown.Header>Мой статус</NavDropdown.Header>
      {WORK_STATUSES.map((status) => (
        <NavDropdown.Item
          key={status.code}
          as="button"
          type="button"
          disabled={busy}
          active={status.code === currentCode}
          onClick={() => {
            setNote("");
            submitStatus(status.code, "");
          }}
        >
          <span className="ws-menu-item">
            <span aria-hidden="true">{status.emoji}</span>
            <span className="ws-menu-item__label">{status.label}</span>
            {status.code === currentCode && (
              <span
                className="ws-menu-item__check"
                style={{ color: status.color }}
              >
                ✓
              </span>
            )}
          </span>
        </NavDropdown.Item>
      ))}
      <div className="ws-menu-note">
        <Form.Control
          size="sm"
          value={note}
          maxLength={100}
          placeholder="Например: за товаром у поставщика"
          aria-label="Заметка к статусу"
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitStatus(currentCode, note);
            }
          }}
        />
        <Button
          size="sm"
          variant="outline-secondary"
          className="mt-1 w-100"
          disabled={busy}
          onClick={() => submitStatus(currentCode, note)}
        >
          Сохранить заметку
        </Button>
      </div>
    </>
  );
};

export default WorkStatusSwitcher;

import { useState } from "react";

import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";
import Badge from "react-bootstrap/Badge";

import { RiPriceTag3Line, RiRefreshLine } from "react-icons/ri";

import AiSection from "./AiSection";
import useViewTicketStore from "../../../store/view-ticket";
import useHttp from "../../../hooks/use-http";
import { getLocalStorageData } from "../../../util/auth";

// Подбор категории заявки ИИ по запросу пользователя. Логика та же, что у фонового
// автоопределения (backend detectTicketCategory) — отличие в том, что результат
// показывается явно: назначенную категорию либо ближайшие варианты с пояснением.
const AiCategory = () => {
  const { token } = getLocalStorageData();

  const ticket = useViewTicketStore((state) => state.ticket);
  const updateTicket = useViewTicketStore((state) => state.updateTicket);

  const { isLoading, error, sendRequest } = useHttp();
  const [feedback, setFeedback] = useState(null);

  const detect = () => {
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-category/detect`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: { _id: ticket._id },
      },
      (data) => {
        const result = data.result || {};
        setFeedback(result);

        // При успешном подборе сразу отражаем категорию в заявке.
        if (result.outcome === "assigned" && result.categoryId) {
          const current = useViewTicketStore.getState().ticket;
          updateTicket({
            ...current,
            category: { _id: result.categoryId, title: result.categoryTitle },
            aiCategory: { status: "processed" },
          });
        }
      },
    );
  };

  const currentTitle = ticket?.category?.title;

  const action = (
    <Button
      variant="outline-secondary"
      size="sm"
      disabled={isLoading}
      onClick={detect}
      title="Подобрать категорию с помощью ИИ"
      className="d-flex align-items-center gap-1 flex-shrink-0"
    >
      {isLoading ? <Spinner animation="border" size="sm" /> : <RiRefreshLine />}
      <span className="d-none d-sm-inline">
        {isLoading ? "Подбираем…" : "Подобрать категорию"}
      </span>
    </Button>
  );

  return (
    <AiSection icon={<RiPriceTag3Line />} label="Категория" action={action}>
      <p className="mb-2">
        Текущая категория:{" "}
        {currentTitle ? (
          <Badge bg="secondary">{currentTitle}</Badge>
        ) : (
          <span className="text-muted">не задана</span>
        )}
      </p>

      {error && !feedback?.outcome && (
        <Alert variant="danger" className="mb-0 py-2 small">
          Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.
        </Alert>
      )}

      {feedback?.outcome === "assigned" && (
        <Alert variant="success" className="mb-0">
          ИИ определил категорию:{" "}
          <strong>«{feedback.categoryTitle}»</strong>
          {feedback.reason && (
            <div className="small mt-1">{feedback.reason}</div>
          )}
        </Alert>
      )}

      {feedback?.outcome === "already_set" && (
        <Alert variant="info" className="mb-0">
          Категория уже задана — ИИ её не меняет. Чтобы переподобрать, сначала
          очистите категорию в заявке.
        </Alert>
      )}

      {feedback?.outcome === "not_found" && (
        <Alert variant="warning" className="mb-0">
          <div className="fw-semibold">
            ИИ не нашёл точно подходящую категорию.
          </div>
          {feedback.reason && (
            <div className="small mt-1">{feedback.reason}</div>
          )}
          {feedback.closest?.length > 0 && (
            <div className="mt-2">
              <div className="small text-muted mb-1">Ближайшие варианты:</div>
              <div className="d-flex flex-wrap gap-1">
                {feedback.closest.map((title, index) => (
                  <Badge bg="light" text="dark" key={index}>
                    {title}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Alert>
      )}

      {feedback?.outcome === "no_categories" && (
        <Alert variant="warning" className="mb-0">
          Нет активных категорий для подбора.
        </Alert>
      )}

      {feedback?.outcome === "error" && (
        <Alert variant="danger" className="mb-0">
          Не удалось подобрать категорию. Подробности — в логе заявки.
        </Alert>
      )}
    </AiSection>
  );
};

export default AiCategory;

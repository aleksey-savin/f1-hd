import { useEffect, useRef } from "react";

import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";

import { RiRobot2Line, RiRefreshLine } from "react-icons/ri";

import useViewTicketStore from "../../../store/view-ticket";
import useHttp from "../../../hooks/use-http";
import { getLocalStorageData } from "../../../util/auth";
import { Row } from "react-bootstrap";

const POLL_INTERVAL = 4000;

const AiGuide = () => {
  const { token } = getLocalStorageData();

  const ticket = useViewTicketStore((state) => state.ticket);
  const updateTicket = useViewTicketStore((state) => state.updateTicket);

  const { isLoading: isRegenerating, sendRequest } = useHttp();
  const { sendRequest: sendToggle } = useHttp();

  const aiGuide = ticket?.aiGuide;
  const status = aiGuide?.status || "idle";

  const applyGuide = (guide) => {
    const current = useViewTicketStore.getState().ticket;
    updateTicket({ ...current, aiGuide: guide });
  };

  // While a generation is running in the background, poll the ticket until the
  // guide is ready (or errored).
  const pollRef = useRef(null);
  useEffect(() => {
    if (status !== "pending" || !ticket?.num) return undefined;

    const poll = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) return;
        const data = await response.json();
        const nextGuide = data.ticket?.aiGuide;
        if (nextGuide?.status && nextGuide.status !== "pending") {
          applyGuide(nextGuide);
        }
      } catch {
        // ignore — keep polling
      }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [status, ticket?.num, token]);

  const regenerate = () => {
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-guide/generate`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: { _id: ticket._id },
      },
      (data) => {
        if (data.aiGuide) applyGuide(data.aiGuide);
      },
    );
  };

  const toggleItem = (index, done) => {
    const current = useViewTicketStore.getState().ticket;
    const items = (current.aiGuide?.items || []).map((item, i) =>
      i === index ? { ...item, done } : item,
    );
    applyGuide({ ...current.aiGuide, items });

    sendToggle(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-guide/toggle-item`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: { _id: ticket._id, index, done },
      },
      () => {},
    );
  };

  const busy = isRegenerating || status === "pending";

  return (
    <Card className="mt-3">
      <Card.Body>
        <Row className="d-flex justify-content-end mb-3">
          <Button
            className="w-auto me-2"
            variant="outline-secondary"
            size="sm"
            disabled={busy}
            onClick={regenerate}
            title="Сгенерировать заново"
          >
            {busy ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <RiRefreshLine />
            )}
          </Button>
        </Row>

        {status === "pending" && (
          <div className="text-muted d-flex align-items-center gap-2">
            <Spinner animation="border" size="sm" /> Анализируем заявку и
            готовим решение…
          </div>
        )}

        {status === "error" && (
          <Alert variant="danger" className="mb-0">
            Не удалось сгенерировать руководство
            {aiGuide?.error ? `: ${aiGuide.error}` : "."} Попробуйте обновить.
          </Alert>
        )}

        {status === "idle" && (
          <p className="text-muted mb-0">
            Руководство ещё не сгенерировано. Нажмите кнопку обновления, чтобы
            создать его.
          </p>
        )}

        {status === "ready" && (
          <>
            {aiGuide.kind === "questions" ? (
              <Alert variant="warning">
                Недостаточно информации для решения. Уточните у пользователя:
              </Alert>
            ) : (
              <>
                {aiGuide.summary && (
                  <p className="text-muted">{aiGuide.summary}</p>
                )}
              </>
            )}

            {(aiGuide.items || []).map((item, index) => (
              <Form.Group className="mb-2" key={index}>
                <Form.Check
                  type="checkbox"
                  id={`ai-guide-item-${index}`}
                  label={item.text}
                  checked={!!item.done}
                  onChange={(event) => toggleItem(index, event.target.checked)}
                />
              </Form.Group>
            ))}

            {(aiGuide.items || []).length === 0 && (
              <p className="text-muted mb-0">Нет пунктов.</p>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default AiGuide;

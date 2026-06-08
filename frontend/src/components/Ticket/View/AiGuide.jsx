import { useEffect, useRef } from "react";
import { Link } from "react-router";

import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";
import Badge from "react-bootstrap/Badge";
import ListGroup from "react-bootstrap/ListGroup";
import ProgressBar from "react-bootstrap/ProgressBar";

import {
  RiRobot2Line,
  RiRefreshLine,
  RiBookOpenLine,
  RiExternalLinkLine,
  RiQuestionLine,
} from "react-icons/ri";

import useViewTicketStore from "../../../store/view-ticket";
import useHttp from "../../../hooks/use-http";
import { getLocalStorageData } from "../../../util/auth";
import { getNoteTypeMeta } from "../../../util/knowledgeNoteTypes";
import { formatDate } from "../../../util/format-date";

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

  const items = aiGuide?.items || [];
  const sources = aiGuide?.sources || [];
  const isQuestions = aiGuide?.kind === "questions";
  const doneCount = items.filter((item) => item.done).length;
  const progress = items.length
    ? Math.round((doneCount / items.length) * 100)
    : 0;

  return (
    <Card className="mt-3 shadow-sm">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span className="d-flex align-items-center gap-2 fw-semibold">
          <RiRobot2Line className="text-success" size={18} /> AI-ассистент
        </span>
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={busy}
          onClick={regenerate}
          title="Сгенерировать заново"
          className="d-flex align-items-center gap-1"
        >
          {busy ? <Spinner animation="border" size="sm" /> : <RiRefreshLine />}
          <span className="d-none d-sm-inline">
            {busy ? "Обновление…" : "Обновить"}
          </span>
        </Button>
      </Card.Header>

      <Card.Body>
        {status === "pending" && (
          <div className="d-flex flex-column align-items-center text-center text-muted py-4 gap-2">
            <Spinner animation="border" />
            <span>Анализируем заявку и базу знаний, готовим решение…</span>
          </div>
        )}

        {status === "error" && (
          <Alert variant="danger" className="mb-0">
            <Alert.Heading className="h6">
              Не удалось сгенерировать руководство
            </Alert.Heading>
            <p className="mb-0 small">
              {aiGuide?.error || "Произошла ошибка."} Попробуйте обновить.
            </p>
          </Alert>
        )}

        {status === "idle" && (
          <div className="d-flex flex-column align-items-center text-center text-muted py-4 gap-2">
            <RiRobot2Line size={32} className="opacity-50" />
            <p className="mb-0">
              Руководство ещё не сгенерировано. Нажмите «Обновить», чтобы создать
              его.
            </p>
          </div>
        )}

        {status === "ready" && (
          <>
            {isQuestions ? (
              <Alert
                variant="warning"
                className="d-flex align-items-start gap-2"
              >
                <RiQuestionLine className="flex-shrink-0 mt-1" size={20} />
                <div>
                  <strong>Недостаточно информации для решения.</strong>
                  <div className="small">Уточните у пользователя:</div>
                </div>
              </Alert>
            ) : (
              aiGuide.summary && (
                <p className="lead fs-6 mb-3">{aiGuide.summary}</p>
              )
            )}

            {items.length > 0 && (
              <>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="text-uppercase small fw-semibold text-muted">
                    {isQuestions ? "Вопросы" : "Шаги решения"}
                  </span>
                  <span className="small text-muted">
                    {doneCount} / {items.length}
                  </span>
                </div>
                <ProgressBar
                  now={progress}
                  variant={progress === 100 ? "success" : "info"}
                  className="mb-3"
                  style={{ height: "0.4rem" }}
                />

                <ListGroup className="mb-0">
                  {items.map((item, index) => (
                    <ListGroup.Item
                      key={index}
                      className="d-flex align-items-start gap-2"
                    >
                      <Form.Check
                        type="checkbox"
                        id={`ai-guide-item-${index}`}
                        className="mb-0"
                        checked={!!item.done}
                        onChange={(event) =>
                          toggleItem(index, event.target.checked)
                        }
                        label={
                          <span
                            className={
                              item.done
                                ? "text-decoration-line-through text-muted"
                                : ""
                            }
                          >
                            {item.text}
                          </span>
                        }
                      />
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              </>
            )}

            {items.length === 0 && (
              <p className="text-muted mb-0">Нет пунктов.</p>
            )}

            {sources.length > 0 && (
              <div className="mt-4">
                <h6 className="text-uppercase small fw-semibold text-muted d-flex align-items-center gap-1 mb-2">
                  <RiBookOpenLine /> Источники из базы знаний
                </h6>
                <ListGroup variant="flush">
                  {sources.map((source) => {
                    const typeMeta = getNoteTypeMeta(source.type);
                    return (
                      <ListGroup.Item
                        key={source._id}
                        as={Link}
                        to={`/knowledge-base/${source._id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        action
                        className="d-flex align-items-center gap-2 px-0"
                      >
                        <Badge bg={typeMeta.badge}>{typeMeta.label}</Badge>
                        <span className="flex-grow-1">{source.title}</span>
                        <RiExternalLinkLine className="text-muted" />
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              </div>
            )}
          </>
        )}
      </Card.Body>

      {status === "ready" && aiGuide.generatedAt && (
        <Card.Footer className="small text-muted d-flex flex-wrap justify-content-between gap-2">
          <span>Сгенерировано {formatDate(aiGuide.generatedAt)}</span>
          {aiGuide.model && <span>Модель: {aiGuide.model}</span>}
        </Card.Footer>
      )}
    </Card>
  );
};

export default AiGuide;

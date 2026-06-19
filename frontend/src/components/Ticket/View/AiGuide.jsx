import { useEffect, useRef } from "react";
import { Link } from "react-router";

import { motion, useReducedMotion } from "framer-motion";

import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";
import Badge from "react-bootstrap/Badge";
import ProgressBar from "react-bootstrap/ProgressBar";

import {
  RiSparkling2Line,
  RiRefreshLine,
  RiBookOpenLine,
  RiExternalLinkLine,
  RiQuestionLine,
} from "react-icons/ri";

import AiSection from "./AiSection";
import ProgressRing from "../../../UI/ProgressRing";
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

  const reduceMotion = useReducedMotion();

  const { isLoading: isRegenerating, error: requestError, sendRequest } =
    useHttp();
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
  const complete = progress === 100;

  // Staggered reveal списка шагов — только если пользователь не просил уменьшить
  // анимацию (тогда motion.div рендерится как обычный div без переходов).
  const listMotion = reduceMotion
    ? {}
    : {
        initial: "hidden",
        animate: "show",
        variants: { show: { transition: { staggerChildren: 0.05 } } },
      };
  const itemMotion = reduceMotion
    ? {}
    : {
        variants: { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } },
        transition: { duration: 0.25 },
      };

  // В шапке раздела показываем «Обновить» только когда уже есть что обновлять.
  // В idle главное действие — крупная primary-кнопка в теле.
  const action =
    status === "idle" ? null : (
      <Button
        variant="outline-secondary"
        size="sm"
        disabled={busy}
        onClick={regenerate}
        title="Сгенерировать заново"
        className="d-flex align-items-center gap-1 flex-shrink-0"
      >
        {busy ? <Spinner animation="border" size="sm" /> : <RiRefreshLine />}
        <span className="d-none d-sm-inline">
          {busy ? "Обновление…" : "Обновить"}
        </span>
      </Button>
    );

  return (
    <AiSection icon={<RiSparkling2Line />} label="Руководство" action={action}>
      {status === "idle" && (
        <div className="text-center text-muted py-4">
          <RiSparkling2Line size={34} className="opacity-50 mb-2" />
          <p className="mb-3">
            Руководство ещё не сгенерировано — ИИ проанализирует заявку и базу
            знаний и предложит шаги решения.
          </p>
          <Button
            variant="success"
            onClick={regenerate}
            disabled={busy}
            className="d-inline-flex align-items-center gap-2"
          >
            {busy ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <RiSparkling2Line />
            )}
            Сгенерировать руководство
          </Button>
        </div>
      )}

      {status === "pending" && (
        <div className="d-flex flex-column align-items-center text-center text-muted py-4 gap-3">
          <span className="ai-pulse d-inline-flex">
            <RiSparkling2Line size={30} className="text-success" />
          </span>
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

      {requestError && status !== "error" && status !== "pending" && (
        <Alert variant="danger" className="mb-0 py-2 small">
          Не удалось отправить запрос. Проверьте соединение и попробуйте снова.
        </Alert>
      )}

      {status === "ready" && (
        <>
          {isQuestions ? (
            <Alert variant="warning" className="d-flex align-items-start gap-2">
              <RiQuestionLine className="flex-shrink-0 mt-1" size={20} />
              <div>
                <strong>Недостаточно информации для решения.</strong>
                <div className="small">
                  Уточните у пользователя приведённые ниже вопросы.
                </div>
              </div>
            </Alert>
          ) : (
            (aiGuide.summary || items.length > 0) && (
              <div className="d-flex align-items-center gap-3 mb-3">
                {items.length > 0 && (
                  <ProgressRing
                    value={doneCount}
                    max={items.length}
                    color={
                      complete ? "var(--bs-success)" : "var(--bs-info)"
                    }
                  />
                )}
                {aiGuide.summary && (
                  <p className="lead fs-6 mb-0">{aiGuide.summary}</p>
                )}
              </div>
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
                variant={complete ? "success" : "info"}
                className="mb-3"
                style={{ height: "0.4rem" }}
              />

              <motion.div {...listMotion}>
                {items.map((item, index) => (
                  <motion.div
                    key={index}
                    {...itemMotion}
                    className={`ai-step ${item.done ? "ai-step--done" : ""}`}
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
                  </motion.div>
                ))}
              </motion.div>
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
              <div className="d-flex flex-column gap-1">
                {sources.map((source) => {
                  const typeMeta = getNoteTypeMeta(source.type);
                  return (
                    <Link
                      key={source._id}
                      to={`/knowledge-base/${source._id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ai-source"
                    >
                      <Badge bg={typeMeta.badge}>{typeMeta.label}</Badge>
                      <span className="ai-source__title">{source.title}</span>
                      <RiExternalLinkLine className="ai-source__ext" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {aiGuide.generatedAt && (
            <div className="d-flex flex-wrap justify-content-between gap-2 small text-muted mt-3 pt-2 border-top">
              <span>Сгенерировано {formatDate(aiGuide.generatedAt)}</span>
              {aiGuide.generatedFromCommentCount > 0 && (
                <span>
                  Учтено комментариев: {aiGuide.generatedFromCommentCount}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </AiSection>
  );
};

export default AiGuide;

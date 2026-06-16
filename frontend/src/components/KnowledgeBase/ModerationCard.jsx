import { useEffect, useState } from "react";
import { Link } from "react-router";

import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";

import ItemCard from "../../UI/ItemCard";
import useInitialPrefsStore from "../../store/prefs";
import { getLocalStorageData } from "../../util/auth";

// Карточка модерации базы знаний на странице заявок (имитирует карточку заявки).
// Видна только модераторам. Счётчики берём из снимка настроек и обновляем свежим
// запросом moderation-summary при монтировании.
const KnowledgeModerationCard = () => {
  const { token } = getLocalStorageData();
  const kb = useInitialPrefsStore((state) => state.knowledgeBase);

  const [counts, setCounts] = useState(
    kb.counts || { pendingApproval: 0, pendingDeletion: 0, secretsFlagged: 0 },
  );

  useEffect(() => {
    if (!kb.isModerator) {
      return;
    }
    const fetchSummary = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes/moderation-summary`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (response.ok) {
          const data = await response.json();
          setCounts({
            pendingApproval: data.pendingApproval || 0,
            pendingDeletion: data.pendingDeletion || 0,
            secretsFlagged: data.secretsFlagged || 0,
          });
        }
      } catch {
        // оставляем снимок из настроек
      }
    };
    fetchSummary();
  }, [kb.isModerator, token]);

  if (!kb.isModerator) {
    return null;
  }

  // Кнопка секретов — только когда поиск секретов включён и есть находки
  const showSecrets = kb.scanForSecrets && counts.secretsFlagged > 0;

  return (
    <ItemCard
      item={{ _id: "kb-moderation" }}
      itemTitle="kbModeration"
      title="База знаний — модерация"
    >
      <div className="d-flex flex-wrap gap-2 mt-2">
        <Button
          as={Link}
          to="/knowledge-base?moderation=all-unapproved"
          variant="outline-warning"
          size="sm"
        >
          Проверить неодобренные{" "}
          <Badge bg="warning" text="dark">
            {counts.pendingApproval}
          </Badge>
        </Button>
        <Button
          as={Link}
          to="/knowledge-base?moderation=pending-deletion"
          variant="outline-info"
          size="sm"
        >
          Заметки на удаление{" "}
          <Badge bg="info" text="dark">
            {counts.pendingDeletion}
          </Badge>
        </Button>
        {showSecrets && (
          <Button
            as={Link}
            to="/knowledge-base?moderation=flagged-secrets"
            variant="outline-danger"
            size="sm"
          >
            Найденные секреты <Badge bg="danger">{counts.secretsFlagged}</Badge>
          </Button>
        )}
      </div>
    </ItemCard>
  );
};

export default KnowledgeModerationCard;

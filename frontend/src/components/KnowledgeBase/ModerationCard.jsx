import { Link } from "react-router";

import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";

import ItemCard from "../../UI/ItemCard";
import useModerationSummary from "./useModerationSummary";

// Кнопка очереди. Deep-link ?moderation=… открывает базу знаний сразу в нужной
// очереди — ключи совпадают с MODERATION_FILTERS в Filter.jsx.
const QUEUES = [
  {
    mode: "all-unapproved",
    label: "На проверку",
    countKey: "pendingApproval",
    variant: "outline-primary",
  },
  {
    mode: "pending-deletion",
    label: "На удаление",
    countKey: "pendingDeletion",
    variant: "outline-danger",
  },
  {
    mode: "pending-archive",
    label: "На архивацию",
    countKey: "pendingArchive",
    variant: "outline-secondary",
  },
  {
    mode: "flagged-secrets",
    label: "Учётные данные",
    countKey: "secretsFlagged",
    variant: "outline-warning",
    needsSecretsScan: true,
  },
];

// Карточка модерации базы знаний на странице заявок (имитирует карточку заявки).
// Видна только модераторам; счётчики берёт из общего стора модерации, который
// обновляется и после массовых действий в самой базе знаний.
const KnowledgeModerationCard = () => {
  const { counts, isModerator, scanForSecrets } = useModerationSummary();

  if (!isModerator) {
    return null;
  }

  // Очередь секретов показываем только при включённом сканере: без него
  // счётчик может остаться от прошлых сканов и вести в пустую очередь.
  const visible = QUEUES.filter(
    (queue) =>
      counts[queue.countKey] > 0 && (!queue.needsSecretsScan || scanForSecrets),
  );

  if (visible.length === 0) {
    return null;
  }

  return (
    <ItemCard
      item={{ _id: "kb-moderation" }}
      itemTitle="kbModeration"
      title="База знаний — модерация"
    >
      <div className="d-flex flex-wrap gap-2 mt-2">
        {visible.map((queue) => (
          <Button
            key={queue.mode}
            as={Link}
            to={`/knowledge-base?moderation=${queue.mode}`}
            variant={queue.variant}
            size="sm"
          >
            {queue.label} <Badge bg="dark">{counts[queue.countKey]}</Badge>
          </Button>
        ))}
      </div>
    </ItemCard>
  );
};

export default KnowledgeModerationCard;

import { useContext, useEffect, useState } from "react";
import { Link } from "react-router";

import Badge from "react-bootstrap/Badge";
import ListGroup from "react-bootstrap/ListGroup";

import ItemCard from "../../UI/ItemCard";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

// Дату храним как UTC-полночь — форматируем в UTC, чтобы день не «съезжал»
const formatDate = (value) =>
  new Date(value).toLocaleDateString("ru-RU", { timeZone: "UTC" });

// Карточка «Домены — продление» на странице заявок: домены, у которых до
// продления остался месяц или меньше (включая просроченные). Видна всем с
// canSeeKnowledgeBase; рендерится только при наличии таких доменов.
const DomainExpiryCard = () => {
  const { token } = getLocalStorageData();
  const { permissions, isAdmin } = useContext(AuthedUserContext);
  const canSee = isAdmin || permissions?.canSeeKnowledgeBase;

  const [domains, setDomains] = useState([]);

  useEffect(() => {
    if (!canSee) {
      return;
    }
    const fetchDomains = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes/domain-expiry`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (response.ok) {
          const data = await response.json();
          setDomains(Array.isArray(data.domains) ? data.domains : []);
        }
      } catch {
        // тихо игнорируем — карточка просто не покажется
      }
    };
    fetchDomains();
  }, [canSee, token]);

  if (!canSee || domains.length === 0) {
    return null;
  }

  return (
    <ItemCard
      item={{ _id: "kb-domain-expiry" }}
      itemTitle="kbDomainExpiry"
      title={`Домены — продление (${domains.length})`}
    >
      <ListGroup variant="flush" className="mt-2">
        {domains.map((domain) => (
          <ListGroup.Item
            key={domain.domain}
            as={Link}
            to={`/knowledge-base/${domain.noteId}`}
            action
            className="d-flex flex-wrap align-items-center gap-2 bg-transparent px-0"
          >
            <span className="fw-semibold">{domain.domain}</span>
            <span className="text-secondary">
              до {formatDate(domain.expiresAt)}
            </span>
            {domain.registrar && (
              <span className="text-secondary small">{domain.registrar}</span>
            )}
            <Badge
              bg={domain.overdue ? "danger" : "warning"}
              text="white"
              className="ms-auto"
            >
              {domain.overdue ? "просрочен" : "скоро"}
            </Badge>
          </ListGroup.Item>
        ))}
      </ListGroup>
    </ItemCard>
  );
};

export default DomainExpiryCard;

import { useContext, useEffect, useState } from "react";
import { Link } from "react-router";

import Badge from "react-bootstrap/Badge";
import ListGroup from "react-bootstrap/ListGroup";
import { RiPriceTag3Line } from "react-icons/ri";

import ItemCard from "../../UI/ItemCard";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
// Дата хранится UTC-полночью — общий календарный форматтер (UTC-пиннинг).
import { formatCalendarDate as formatDate } from "../../util/format-date";

// Карточка «Продление услуг» на странице заявок: услуги, у которых до продления
// остался месяц или меньше (включая просроченные). Видна всем с
// canSeeKnowledgeBase; рендерится только при наличии таких услуг.
const ServiceExpiryCard = () => {
  const { token } = getLocalStorageData();
  const { permissions, isAdmin } = useContext(AuthedUserContext);
  const canSee = isAdmin || permissions?.canSeeKnowledgeBase;

  const [services, setServices] = useState([]);

  useEffect(() => {
    if (!canSee) {
      return;
    }
    const fetchServices = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes/service-expiry`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (response.ok) {
          const data = await response.json();
          setServices(Array.isArray(data.services) ? data.services : []);
        }
      } catch {
        // тихо игнорируем — карточка просто не покажется
      }
    };
    fetchServices();
  }, [canSee, token]);

  if (!canSee || services.length === 0) {
    return null;
  }

  return (
    <ItemCard
      item={{ _id: "kb-service-expiry" }}
      itemTitle="kbServiceExpiry"
      title={`Продление услуг (${services.length})`}
    >
      <ListGroup variant="flush" className="mt-2">
        {services.map((service) => (
          <ListGroup.Item
            key={service.service}
            as={Link}
            to={`/knowledge-base/${service.noteId}`}
            action
            className="d-flex flex-wrap align-items-center gap-2 bg-transparent px-0"
          >
            {(service.categories || []).map((category) => (
              <Badge key={category._id} bg="info" className="fw-normal">
                <RiPriceTag3Line /> {category.title}
              </Badge>
            ))}
            <span className="fw-semibold">{service.service}</span>
            <span className="text-body-secondary">
              до {formatDate(service.expiresAt)}
            </span>
            {service.registrar && (
              <span className="text-body-secondary small">
                {service.registrar}
              </span>
            )}
            <Badge
              bg={service.overdue ? "danger" : "warning"}
              text="white"
              className="ms-auto"
            >
              {service.overdue ? "просрочена" : "скоро"}
            </Badge>
          </ListGroup.Item>
        ))}
      </ListGroup>
    </ItemCard>
  );
};

export default ServiceExpiryCard;
